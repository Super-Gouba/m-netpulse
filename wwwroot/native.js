/* ============================================================
   M-NetPulse · native.js — C# 宿主桥接层（真实数据采集）
   宿主每秒通过 'netpulse' MessageEvent 推送：
     { downBps, upBps, downTotal, upTotal, adapter, speed, apps, conns }
   apps：按 PID 聚合的真实速率与累计；conns：真实 TCP 连接与收发字节。
   ============================================================ */

(function () {
  const NATIVE = { active: false, lastMsg: 0, conns: [], apps: [], pidTrafficOk: false };
  window.__NETPULSE_NATIVE = NATIVE;
  window.__npAppRates = {};      // appId -> { down, up } 真实字节/秒
  const COLORS = ["#5b9cf5", "#8a6cf0", "#22c55e", "#f47ba0", "#22d3a5", "#4aa8ff",
                  "#5aa0e8", "#e8eef8", "#38bdf8", "#f5a623", "#a78bfa", "#fb7185"];
  const GB = 1073741824;

  const isPrivate = (ip) =>
    /^(10\.|192\.168\.|127\.|169\.254\.)/.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

  let lastSig = "";

  function updateAppsChrome() {
    const sub = $("#appsSub");
    if (sub) {
      const unresolved = DB.apps.filter((a) => /^PID \d+$/.test(a.name)).length;
      let txt = DB.apps.length
        ? `真实采集 · ${DB.apps.length} 个进程正在通信${NATIVE.pidTrafficOk ? "" : " · 速率/累计不可用"}`
        : "数据来自系统网络堆栈";
      if (unresolved) txt += " · 部分连接归属宿主网络栈，无法解析为本机进程名";
      sub.textContent = txt;
    }
    const empty = $("#appsEmpty");
    if (empty) {
      empty.style.display = DB.apps.length ? "none" : "";
      empty.innerHTML = NATIVE.pidTrafficOk
        ? "暂未采集到正在通信的进程。<br>只有当前有真实网络连接的进程才会出现在这里。"
        : "本机不支持按连接字节统计，无法给出进程速率与累计。<br>仍可在「连接详情」查看真实的进程与远程地址。";
    }
  }

  function rebuildApps(apps) {
    NATIVE.apps = apps;
    const sig = apps.map((a) => a.pid).join(",");
    DB.apps = apps.map((a, i) => {
      const id = "p" + a.pid;
      window.__npAppRates[id] = { down: a.down || 0, up: a.up || 0 };
      return {
        id,
        name: a.name,
        proc: a.proc,
        color: COLORS[i % COLORS.length],
        down: a.down || 0,
        up: a.up || 0,
        total: (a.sdown + a.sup) / GB,
        conns: a.conns,
        limit: null,
        limited: false,
        firstSeen: "",
      };
    });

    /* 进程集合变化时才重建表格与过滤下拉，避免勾选状态被刷新打断 */
    updateAppsChrome();
    if (sig === lastSig) return;
    lastSig = sig;

    const sel = $("#connAppFilter");
    if (sel) {
      sel.innerHTML = '<option value="">全部应用</option>';
      DB.apps.forEach((a) => {
        const opt = document.createElement("option");
        opt.value = a.id;
        opt.textContent = a.name;
        sel.appendChild(opt);
      });
    }
    if (typeof refreshCharts !== "undefined" && document.body.dataset.page === "apps") {
      refreshCharts.apps();
    }
  }

  function rebuildConns(conns) {
    NATIVE.conns = conns;
    DB.conns = conns.map((c, i) => ({
      id: i,
      app: "p" + c.pid,
      remote: c.remote,
      host: "",
      port: c.port,
      proto: "TCP",
      state: "已建立",
      down: c.down || 0,
      up: c.up || 0,
      geo: isPrivate(c.remote) ? "内网 · 局域网" : "公网",
      flag: isPrivate(c.remote) ? "LAN" : "WAN",
    }));

    const dc = $("#dashConns");
    if (dc) dc.textContent = conns.length;

    if (typeof renderConns === "function" && document.body.dataset.page === "conns") {
      renderConns();
      refreshCharts.conns();
    }
  }

  window.addEventListener("netpulse", (ev) => {
    const d = ev.data;
    if (!d || typeof d.downBps !== "number") return;
    NATIVE.active = true;
    NATIVE.lastMsg = Date.now();
    NATIVE.pidTrafficOk = d.pidTrafficOk === true;

    /* 全局速率（bytes/s → MB/s，供曲线与顶栏） */
    RT.down = Math.max(0, d.downBps / 1048576);
    RT.up = Math.max(0, d.upBps / 1048576);
    RT.nativeTotals = { recv: d.downTotal, sent: d.upTotal };

    if (d.adapter && $("#tbAdapter")) {
      $("#tbAdapter").textContent = d.adapter.split(" ").slice(0, 2).join(" ");
    }

    /* 今日累计 */
    const gbR = d.downTotal / GB, gbS = d.upTotal / GB;
    const foots = $$(".metric .m-foot .mono");
    if (foots[0]) foots[0].textContent = fmtGB(gbR) + " GB";
    if (foots[1]) foots[1].textContent = fmtGB(gbS) + " GB";
    const tdr = $("#rtTodayDown"), tur = $("#rtTodayUp");
    if (tdr) tdr.textContent = fmtGB(gbR) + " GB";
    if (tur) tur.textContent = fmtGB(gbS) + " GB";

    if (Array.isArray(d.apps)) rebuildApps(d.apps);
    if (Array.isArray(d.conns)) rebuildConns(d.conns);
  });

  /* 原生数据 3 秒未更新则回落 mock 模式 */
  setInterval(() => {
    if (NATIVE.active && Date.now() - NATIVE.lastMsg > 3000) NATIVE.active = false;
  }, 1000);
})();
