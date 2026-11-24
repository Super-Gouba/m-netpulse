/* ============================================================
   M-NetPulse · mock.js — 唯一数据源（原型演示数据）
   TODO: 接入真实数据时替换为 API 层（api.js）
   ============================================================ */

const DB = {
  /* 网卡 */
  adapters: [
    { id: "eth0", name: "以太网 · Realtek PCIe GbE", ip: "192.168.1.108", status: "up",   speed: "1.0 Gbps", isDefault: true },
    { id: "wifi0", name: "WLAN · Intel AX210",       ip: "192.168.1.112", status: "down", speed: "WiFi 6E",  isDefault: false },
  ],

  /* 应用/进程流量（实时视图 + 应用视图共用） */
  apps: [
    { id: "chrome",   name: "Chrome 浏览器",  proc: "chrome.exe",   color: "#5b9cf5", down: 4216400, up: 352000,  total: 8.42, session: 2.17, conns: 28, limit: null, limited: false, firstSeen: "2026-11-12" },
    { id: "steam",    name: "Steam",          proc: "steam.exe",    color: "#8a6cf0", down: 12850000, up: 128000, total: 24.61, session: 9.83, conns: 12, limit: 2,  limited: true,  firstSeen: "2026-11-12" },
    { id: "weixin",   name: "微信",           proc: "WeChat.exe",   color: "#22c55e", down: 218400,  up: 156700,  total: 1.09, session: 0.36, conns: 9,  limit: null, limited: false, firstSeen: "2026-11-12" },
    { id: "bilibili", name: "哔哩哔哩客户端", proc: "bilibili.exe", color: "#f47ba0", down: 3120000, up: 96000,   total: 6.35, session: 3.42, conns: 6,  limit: null, limited: false, firstSeen: "2026-11-18" },
    { id: "qqmusic",  name: "QQ音乐",         proc: "QQMusic.exe",  color: "#22d3a5", down: 486000,  up: 62000,   total: 1.24, session: 0.52, conns: 4,  limit: null, limited: false, firstSeen: "2026-10-02" },
    { id: "vscode",   name: "VS Code",        proc: "Code.exe",     color: "#4aa8ff", down: 84000,   up: 48000,   total: 0.31, session: 0.12, conns: 5,  limit: null, limited: false, firstSeen: "2026-11-01" },
    { id: "update",   name: "Windows 更新",   proc: "svchost.exe",  color: "#5aa0e8", down: 1860000, up: 210000,  total: 4.02, session: 0.87, conns: 3,  limit: 1,  limited: true,  firstSeen: "2026-09-14" },
    { id: "obs",      name: "OBS Studio",     proc: "obs64.exe",    color: "#e8eef8", down: 132000,  up: 2740000, total: 5.87, session: 1.94, conns: 2,  limit: null, limited: false, firstSeen: "2026-11-20" },
    { id: "cloud",    name: "OneDrive",       proc: "OneDrive.exe", color: "#38bdf8", down: 960000,  up: 1240000, total: 2.28, session: 0.66, conns: 4,  limit: null, limited: false, firstSeen: "2026-09-14" },
    { id: "game",     name: "英雄联盟",       proc: "LeagueClient.exe", color: "#f5a623", down: 92000, up: 74000, total: 0.48, session: 0.21, conns: 7, limit: null, limited: false, firstSeen: "2026-11-16" },
  ],

  /* 活动连接（连接视图） */
  conns: [
    { id: 1, app: "steam",    remote: "103.10.124.38",  host: "cdn-akamai.steamstatic.com", port: 443,  proto: "TCP",  state: "已建立", down: 12400000, up: 118000, geo: "新加坡",    flag: "SG" },
    { id: 2, app: "chrome",   remote: "142.250.66.142", host: "www.google.com",             port: 443,  proto: "TCP",  state: "已建立", down: 1640000,  up: 84000,  geo: "美国",      flag: "US" },
    { id: 3, app: "bilibili", remote: "111.62.119.20",  host: "upos-hz-mirrorakam.akamaized.net", port: 443, proto: "TCP", state: "已建立", down: 3120000, up: 96000, geo: "杭州 · 阿里云", flag: "CN" },
    { id: 4, app: "weixin",   remote: "121.51.12.18",   host: "szlong.weixin.qq.com",       port: 8080, proto: "TCP",  state: "已建立", down: 218400,  up: 156700, geo: "深圳 · 腾讯", flag: "CN" },
    { id: 5, app: "chrome",   remote: "104.18.32.115",  host: "cloudflare-dns.com",         port: 443,  proto: "UDP",  state: "已建立", down: 420000,  up: 12000,  geo: "美国",      flag: "US" },
    { id: 6, app: "obs",      remote: "58.215.53.101",  host: "rtmp-push.wushuang.live",    port: 1935, proto: "TCP",  state: "已建立", down: 32000,   up: 2740000, geo: "无锡 · 电信", flag: "CN" },
    { id: 7, app: "game",     remote: "203.107.32.66",  host: "gateway.lol.qq.com",         port: 5222, proto: "TCP",  state: "已建立", down: 92000,   up: 74000,  geo: "上海 · 腾讯", flag: "CN" },
    { id: 8, app: "cloud",    remote: "20.42.65.88",    host: "oneclient-storage.blob.core.windows.net", port: 443, proto: "TCP", state: "已建立", down: 960000, up: 1240000, geo: "美国 · Azure", flag: "US" },
    { id: 9, app: "qqmusic",  remote: "111.30.144.8",   host: "ws.stream.qqmusic.qq.com",   port: 443,  proto: "TCP",  state: "已建立", down: 486000,  up: 62000,  geo: "北京 · 腾讯", flag: "CN" },
    { id: 10, app: "update",  remote: "40.90.23.154",   host: "windowsupdate.microsoft.com", port: 443, proto: "TCP",  state: "已建立", down: 1860000, up: 210000, geo: "美国 · Azure", flag: "US" },
    { id: 11, app: "vscode",  remote: "140.82.112.26",  host: "github.com",                 port: 443,  proto: "TCP",  state: "已建立", down: 84000,   up: 48000,  geo: "美国",      flag: "US" },
  ],

  /* 月度套餐与配额 */
  quota: { name: "家庭宽带 300M", monthlyCapGB: 500, usedGB: 342.6, month: "2026年11月", daysLeft: 6 },

  /* 今日/本周汇总 */
  today: { down: 12.83, up: 3.27, peak: "14:22 · 58.4 MB/s" },
  week: { down: 68.42, up: 17.15 },

  /* 历史报表（最近14天，GB） */
  history: [
    { d: "11", down: 4.2, up: 1.1 }, { d: "12", down: 6.8, up: 2.3 }, { d: "13", down: 3.1, up: 0.9 },
    { d: "14", down: 2.4, up: 0.7 }, { d: "15", down: 8.9, up: 3.2 }, { d: "16", down: 5.2, up: 1.8 },
    { d: "17", down: 4.6, up: 1.4 }, { d: "18", down: 9.8, up: 2.1 }, { d: "19", down: 7.3, up: 4.6 },
    { d: "20", down: 11.2, up: 6.8 }, { d: "21", down: 6.4, up: 1.9 }, { d: "22", down: 5.1, up: 1.2 },
    { d: "23", down: 8.7, up: 2.8 }, { d: "24", down: 12.8, up: 3.3 },
  ],

  /* 告警中心 */
  alerts: [
    { id: 1, type: "danger", icon: "alert-triangle", title: "月度流量已达 68.5%", desc: "本月已消耗 342.6 GB / 500 GB，剩余 6 天。建议开启省流模式。", time: "刚刚" },
    { id: 2, type: "warn",   icon: "gauge",          title: "Steam 高速下载进行中", desc: "下行速率 12.8 MB/s，持续 9 分钟，已限制至 2 MB/s。", time: "14:22" },
    { id: 3, type: "info",   icon: "shield-question", title: "新应用首次联网", desc: "“LeagueClient.exe”于 16:04 请求网络连接（上海 · 腾讯云）。", time: "16:04" },
    { id: 4, type: "danger", icon: "wifi-off",       title: "WLAN 连接中断", desc: "Intel AX210 已断开 3 次，最近一次为 11:37。", time: "11:37" },
  ],

  /* 应用用量排行（报表视图，本月 GB） */
  usageTop: [
    { id: "steam",    down: 96.4, up: 8.2 },
    { id: "chrome",   down: 78.6, up: 12.4 },
    { id: "bilibili", down: 64.2, up: 3.1 },
    { id: "cloud",    down: 31.8, up: 24.6 },
    { id: "update",   down: 28.4, up: 4.8 },
    { id: "obs",      down: 6.2,  up: 42.1 },
    { id: "weixin",   down: 12.8, up: 9.6 },
    { id: "qqmusic",  down: 9.4,  up: 1.2 },
  ],
};

/* 工具：字节格式化 */
function fmtBytes(b) {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + " MB/s";
  if (b >= 1024) return (b / 1024).toFixed(0) + " KB/s";
  return b.toFixed(0) + " B/s";
}
/* 工具：GB 格式化 */
function fmtGB(gb) { return gb >= 100 ? gb.toFixed(0) : gb.toFixed(1); }

/* 导出（供 api.js / 主逻辑使用） */
if (typeof window !== "undefined") window.DB = DB;
