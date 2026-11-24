using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;

namespace MNetPulse;

/// <summary>
/// 网络流量采集服务：
/// - 全局速率：NetworkInformation 性能计数（IP 全局统计），1 秒采样
/// - 今日累计：跨运行持久化到 %LocalAppData%\MNetPulse\usage.json
/// - 连接列表：GetExtendedTcpTable (P/Invoke) + 进程名映射
/// </summary>
public sealed class TrafficMonitor : IDisposable
{
    // ---------- 全局速率 ----------
    private DateTime _lastTime = DateTime.MinValue;
    private double _downBps, _upBps;          // bytes/sec

    // 每块在线网卡一对计数器（Network Interface 类别没有 _Total 实例，必须逐卡求和）
    private readonly List<(PerformanceCounter Recv, PerformanceCounter Sent)> _nicCounters = new();

    // ---------- 今日累计 ----------
    private long _dayRecv, _daySent;
    private string _dayStamp = "";

    // ---------- 连接 ----------
    private List<ConnInfo> _conns = new();

    // ---------- 进程级流量（每 TCP 连接 EStats 字节计数，差分得速率） ----------
    private Dictionary<ConnKey, (int Pid, long In, long Out)> _connBytesNow = new();
    private Dictionary<ConnKey, (int Pid, long In, long Out)> _connBytesPrev = new();
    private Dictionary<int, (long In, long Out)> _pidRate = new();
    private readonly Dictionary<int, long> _sessionDown = new();
    private readonly Dictionary<int, long> _sessionUp = new();
    private Dictionary<int, string> _pidNames = new();
    private DateTime _namesStamp = DateTime.MinValue;
    private DateTime _lastDiag = DateTime.MinValue;
    private int _diagRows, _diagOk, _diagFail;
    private uint _diagLastRet;
    /// <summary>本机是否支持按连接字节统计（决定进程速率/累计是否可信）。</summary>
    public bool PidStatsWorking { get; private set; }

    public double DownBps => _downBps;
    public double UpBps => _upBps;
    public long DayRecv => _dayRecv;
    public long DaySent => _daySent;
    public IReadOnlyList<ConnInfo> Conns => _conns;
    public string AdapterName { get; private set; } = "网络";
    public string AdapterSpeed { get; private set; } = "";

    /// <summary>当前各进程实时速率与会话累计（按总流量降序）。</summary>
    public List<ProcTraffic> GetProcessTraffic()
    {
        var now = DateTime.Now;
        if ((now - _namesStamp).TotalSeconds > 5)
        {
            RefreshPidNames();
        }

        // 进程集合 = 有速率采样的 + 有会话累计的 + TCP 表中出现过的真实进程
        var ids = new HashSet<int>(_pidRate.Keys);
        ids.UnionWith(_sessionDown.Keys);
        foreach (var c in _conns) ids.Add(c.Pid);
        var result = new List<ProcTraffic>();
        foreach (int pid in ids)
        {
            _pidRate.TryGetValue(pid, out var rt);
            string raw = _pidNames.TryGetValue(pid, out var n) ? n : "";
            result.Add(new ProcTraffic
            {
                Pid = pid,
                Name = raw.Length > 0 ? raw : ("PID " + pid),
                Proc = raw.Length > 0 ? raw + ".exe" : "unknown",
                DownBps = rt.In, UpBps = rt.Out,
                SessionDown = _sessionDown.GetValueOrDefault(pid),
                SessionUp = _sessionUp.GetValueOrDefault(pid),
                Conns = _conns.Count(c => c.Pid == pid),
            });
        }
        return result.OrderByDescending(p => p.DownBps + p.UpBps).ToList();
    }

    private void RefreshPidNames()
    {
        _namesStamp = DateTime.Now;
        _pidNames = new Dictionary<int, string>();
        foreach (var p in Process.GetProcesses())
        {
            try { _pidNames[p.Id] = p.ProcessName; } catch { }
        }
    }

    private sealed class PersistState
    {
        public string Day { get; set; } = "";
        public long Recv { get; set; }
        public long Sent { get; set; }
    }

    private readonly string _statePath;
    private readonly System.Timers.Timer _timer;

    public TrafficMonitor()
    {
        string dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "MNetPulse");
        Directory.CreateDirectory(dir);
        _statePath = Path.Combine(dir, "usage.json");
        LoadState();
        InitNetwork();

        _timer = new System.Timers.Timer(1000) { SynchronizingObject = null };
        _timer.Elapsed += (_, _) => Sample();
        _timer.Start();
    }

    private void LoadState()
    {
        try
        {
            if (!File.Exists(_statePath)) return;
            var st = System.Text.Json.JsonSerializer.Deserialize<PersistState>(File.ReadAllText(_statePath));
            if (st != null && st.Day == DateTime.Today.ToString("yyyy-MM-dd"))
            {
                _dayStamp = st.Day; _dayRecv = st.Recv; _daySent = st.Sent;
            }
        }
        catch { /* 损坏则忽略，从零累计 */ }
    }

    private void SaveState()
    {
        try
        {
            File.WriteAllText(_statePath, System.Text.Json.JsonSerializer.Serialize(new PersistState
            {
                Day = _dayStamp, Recv = _dayRecv, Sent = _daySent
            }));
        }
        catch { }
    }

    private void InitNetwork()
    {
        var best = NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.NetworkInterfaceType != NetworkInterfaceType.Loopback
                     && n.NetworkInterfaceType != NetworkInterfaceType.Tunnel
                     && n.OperationalStatus == OperationalStatus.Up)
            .OrderByDescending(n => n.Speed)
            .FirstOrDefault();
        if (best != null)
        {
            AdapterName = best.Description;
            AdapterSpeed = best.Speed >= 1_000_000_000
                ? (best.Speed / 1_000_000_000.0).ToString("0.#", CultureInfo.InvariantCulture) + " Gbps"
                : (best.Speed / 1_000_000.0).ToString("0", CultureInfo.InvariantCulture) + " Mbps";
        }

        // 逐块网卡创建计数器：部分虚拟网卡（TAP/WAN Miniport 等）在类别中无实例，跳过即可
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces()
                     .Where(n => n.OperationalStatus == OperationalStatus.Up
                              && n.NetworkInterfaceType != NetworkInterfaceType.Loopback))
        {
            try
            {
                string inst = ni.Description;
                var recv = new PerformanceCounter("Network Interface", "Bytes Received/Sec", inst);
                var sent = new PerformanceCounter("Network Interface", "Bytes Sent/Sec", inst);
                recv.NextValue(); sent.NextValue();   // 预热：rate 计数器首次读数为 0
                _nicCounters.Add((recv, sent));
            }
            catch { /* 该网卡无性能计数器实例，忽略 */ }
        }
        Program.Log($"InitNetwork: 网卡={AdapterName} 计数器对={_nicCounters.Count}");
    }

    private void Sample()
    {
        SampleGlobal();
        SampleConnections();
    }

    /// <summary>全局速率与今日累计：逐块网卡计数器求和（失败不得影响连接采集）。</summary>
    private void SampleGlobal()
    {
        try
        {
            double recv = 0, sent = 0;
            foreach (var (r, s) in _nicCounters)
            {
                try { recv += r.NextValue(); sent += s.NextValue(); } catch { }
            }
            _downBps = Math.Max(0, recv);
            _upBps = Math.Max(0, sent);

            var now = DateTime.UtcNow;
            if (_lastTime != DateTime.MinValue)
            {
                double sec = (now - _lastTime).TotalSeconds;
                if (sec > 0.2)
                {
                    _dayRecv = Math.Max(0, _dayRecv + (long)(_downBps * sec));
                    _daySent = Math.Max(0, _daySent + (long)(_upBps * sec));

                    string today = DateTime.Today.ToString("yyyy-MM-dd");
                    if (_dayStamp != today)
                    {
                        _dayStamp = today; _dayRecv = 0; _daySent = 0;
                    }
                    SaveState();
                }
            }
            _lastTime = now;
        }
        catch (Exception ex)
        {
            Program.Log("[Sample] 全局速率异常: " + ex.Message);
        }
    }

    /// <summary>TCP 连接与进程流量聚合（失败不得影响全局速率）。</summary>
    private void SampleConnections()
    {
        try
        {
            _conns = CollectConnections(out var cur);
            var rate = new Dictionary<int, (long In, long Out)>();
            foreach (var kv in cur)
            {
                int pid = kv.Value.Pid;
                if (!_connBytesPrev.TryGetValue(kv.Key, out var p))
                {
                    // 首次出现的连接：不计入速率与累计，避免把历史总量一次性算入
                    continue;
                }
                long dIn = Math.Max(0, kv.Value.In - p.In);
                long dOut = Math.Max(0, kv.Value.Out - p.Out);
                if (dIn == 0 && dOut == 0) continue;
                _sessionDown[pid] = _sessionDown.GetValueOrDefault(pid) + dIn;
                _sessionUp[pid] = _sessionUp.GetValueOrDefault(pid) + dOut;
                if (rate.TryGetValue(pid, out var rr)) rate[pid] = (rr.In + dIn, rr.Out + dOut);
                else rate[pid] = (dIn, dOut);
            }
            _connBytesPrev = _connBytesNow;
            _connBytesNow = cur;
            _pidRate = rate;

            // 诊断：每 15s 记录一次采样情况（写入 startup.log）
            if ((DateTime.Now - _lastDiag).TotalSeconds > 15)
            {
                _lastDiag = DateTime.Now;
                var top = rate.Count > 0
                    ? string.Join(", ", rate.OrderByDescending(kv => kv.Value.In + kv.Value.Out)
                        .Take(5).Select(kv => $"{(_pidNames.TryGetValue(kv.Key, out var nm) ? nm : kv.Key.ToString())}:{kv.Value.In}+{kv.Value.Out}B/s"))
                    : "无";
                Program.Log($"[PID] 全局↓={_downBps:F0}B/s ↑={_upBps:F0}B/s | 行数={_diagRows} EStats成功={_diagOk} 失败={_diagFail} 末次ret={_diagLastRet} 活跃进程流量: {top}");
            }
        }
        catch (Exception ex)
        {
            Program.Log("[Sample] 连接采集异常: " + ex.Message);
        }
    }

    // ---------- TCP 连接 + 进程映射 + 每连接字节计数 ----------
    private List<ConnInfo> CollectConnections(out Dictionary<ConnKey, (int Pid, long In, long Out)> connBytes)
    {
        var list = new List<ConnInfo>();
        connBytes = new();
        int rows = 0, ok = 0, fail = 0;
        uint lastRet = 0;
        if ((DateTime.Now - _namesStamp).TotalSeconds > 5) RefreshPidNames();
        var pidMap = _pidNames;

        try
        {
            var table = GetTcpRows();
            foreach (var r in table)
            {
                rows++;
                int remotePort = (int)((r.remotePort >> 8) | ((r.remotePort & 0xFF) << 8));
                if (remotePort == 0) continue;      // 监听 socket 无流量
                int pid = (int)r.owningPid;

                bool hasBytes = TryReadEStats(r, out long inB, out long outB, ref lastRet);
                if (hasBytes) ok++; else fail++;
                if (hasBytes)
                {
                    var key = new ConnKey(r.localAddr, r.localPort, r.remoteAddr, r.remotePort);
                    if (connBytes.TryGetValue(key, out var ex)) connBytes[key] = (ex.Pid, ex.In + inB, ex.Out + outB);
                    else connBytes[key] = (pid, inB, outB);
                }

                if ((int)r.state != (int)MIB_TCP_STATE.ESTAB) continue;
                string pname = pidMap.TryGetValue(pid, out var n) ? n + ".exe" : "";
                var localIp = new IPAddress(BitConverter.GetBytes(r.localAddr));
                var remoteIp = new IPAddress(BitConverter.GetBytes(r.remoteAddr));
                int localPort = (int)((r.localPort >> 8) | ((r.localPort & 0xFF) << 8));
                list.Add(new ConnInfo
                {
                    Pid = pid,
                    Process = pname,
                    Remote = remoteIp.ToString(),
                    Port = remotePort,
                    LocalPort = localPort,
                    Down = hasBytes ? inB : 0,
                    Up = hasBytes ? outB : 0,
                });
            }
        }
        catch { }
        _diagRows = rows; _diagOk = ok; _diagFail = fail; _diagLastRet = lastRet;
        if (ok > 0) PidStatsWorking = true;
        return list.Take(200).ToList();
    }

    #region Win32 — GetExtendedTcpTable / GetPerTcpConnectionEStats
    [StructLayout(LayoutKind.Sequential)]
    private struct MIB_TCPROW_OWNER_PID
    {
        public uint state;
        public uint localAddr;
        public uint localPort;   // 网络字节序
        public uint remoteAddr;
        public uint remotePort;
        public uint owningPid;
    }

    /* GetPerTcpConnectionEStats 的入参只需要前 5 个字段（不含 PID） */
    [StructLayout(LayoutKind.Sequential)]
    private struct MIB_TCPROW
    {
        public uint state;
        public uint localAddr;
        public uint localPort;
        public uint remoteAddr;
        public uint remotePort;
    }

    private readonly record struct ConnKey(uint LocalAddr, uint LocalPort, uint RemoteAddr, uint RemotePort);

    private enum TCP_TABLE_CLASS { TCP_TABLE_OWNER_PID_ALL = 1 }
    private enum MIB_TCP_STATE : uint { ESTAB = 5 }
    private enum TCP_ESTATS_TYPE { TcpConnectionEstatsData = 1 }

    [DllImport("iphlpapi.dll", SetLastError = true)]
    private static extern uint GetExtendedTcpTable(IntPtr pTcpTable, ref int dwOutBufLen, bool sort,
        int ipVersion, TCP_TABLE_CLASS tableClass, int reserved);

    [DllImport("iphlpapi.dll", SetLastError = true)]
    private static extern uint GetPerTcpConnectionEStats(IntPtr pTcpRow, TCP_ESTATS_TYPE EstatsType,
        IntPtr Rw, uint RwVersion, uint RwSize,
        IntPtr Ros, uint RosVersion, uint RosSize,
        IntPtr Rod, uint RodVersion, uint RodSize);

    /// <summary>读取单条 TCP 连接的累计收发字节（TCP_ESTATS_DATA_ROD_v0：出 0 / 入 16 偏移）。</summary>
    private bool TryReadEStats(MIB_TCPROW_OWNER_PID r, out long inB, out long outB, ref uint lastRet)
    {
        inB = 0; outB = 0; lastRet = 0;
        const int rodSize = 32;     // 4 × ulong64
        IntPtr rowBuf = IntPtr.Zero, rodBuf = IntPtr.Zero;
        try
        {
            rowBuf = Marshal.AllocHGlobal(Marshal.SizeOf<MIB_TCPROW>());
            Marshal.WriteInt32(rowBuf, 0, (int)r.state);
            Marshal.WriteInt32(rowBuf, 4, (int)r.localAddr);
            Marshal.WriteInt32(rowBuf, 8, (int)r.localPort);
            Marshal.WriteInt32(rowBuf, 12, (int)r.remoteAddr);
            Marshal.WriteInt32(rowBuf, 16, (int)r.remotePort);

            rodBuf = Marshal.AllocHGlobal(rodSize);
            uint ret = GetPerTcpConnectionEStats(rowBuf, TCP_ESTATS_TYPE.TcpConnectionEstatsData,
                IntPtr.Zero, 0, 0, IntPtr.Zero, 0, 0, rodBuf, 0, rodSize);
            lastRet = ret;
            if (ret != 0) return false;
            outB = (long)Marshal.ReadInt64(rodBuf, 0);    // DataBytesOut
            inB = (long)Marshal.ReadInt64(rodBuf, 16);    // DataBytesIn
            return true;
        }
        catch { return false; }
        finally
        {
            if (rowBuf != IntPtr.Zero) Marshal.FreeHGlobal(rowBuf);
            if (rodBuf != IntPtr.Zero) Marshal.FreeHGlobal(rodBuf);
        }
    }

    private static List<MIB_TCPROW_OWNER_PID> GetTcpRows()
    {
        const int AF_INET = 2;
        int len = 0;
        // 首次调用通常返回 ERROR_INSUFFICIENT_BUFFER(122)，但会通过 dwOutBufLen 回传所需长度
        GetExtendedTcpTable(IntPtr.Zero, ref len, false, AF_INET, TCP_TABLE_CLASS.TCP_TABLE_OWNER_PID_ALL, 0);
        if (len <= 0) return new();

        var buf = Marshal.AllocHGlobal(len);
        try
        {
            if (GetExtendedTcpTable(buf, ref len, false, AF_INET, TCP_TABLE_CLASS.TCP_TABLE_OWNER_PID_ALL, 0) != 0)
                return new();

            int n = Marshal.ReadInt32(buf, 0);
            var rows = new List<MIB_TCPROW_OWNER_PID>(n);
            int rowSize = Marshal.SizeOf<MIB_TCPROW_OWNER_PID>();
            for (int i = 0; i < n; i++)
            {
                rows.Add(Marshal.PtrToStructure<MIB_TCPROW_OWNER_PID>(buf + 4 + i * rowSize));
            }
            return rows;
        }
        finally { Marshal.FreeHGlobal(buf); }
    }
    #endregion

    public void Dispose()
    {
        _timer?.Stop();
        _timer?.Dispose();
        foreach (var (r, s) in _nicCounters)
        {
            try { r.Dispose(); } catch { }
            try { s.Dispose(); } catch { }
        }
        SaveState();
    }
}

public sealed class ConnInfo
{
    public int Pid { get; set; }
    public string Process { get; set; } = "";
    public string Remote { get; set; } = "";
    public int Port { get; set; }
    public int LocalPort { get; set; }
    /// <summary>该连接自建立以来的累计下行/上行字节（EStats 只读计数）。</summary>
    public long Down { get; set; }
    public long Up { get; set; }
}

public sealed class ProcTraffic
{
    public int Pid { get; set; }
    public string Name { get; set; } = "";
    public string Proc { get; set; } = "";
    public long DownBps { get; set; }
    public long UpBps { get; set; }
    public long SessionDown { get; set; }
    public long SessionUp { get; set; }
    public int Conns { get; set; }
}
