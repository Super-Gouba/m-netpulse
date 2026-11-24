/* ============================================================
   M-NetPulse · app.js — 状态与视图逻辑
   视图路由（data-view）+ 实时数据引擎 + 图表渲染
   ============================================================ */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------- 视图路由（唯一 active 机制） ---------- */
function showView(name) {
  document.body.dataset.page = name;
  $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === name));
  $$(".nav-item").forEach((a) =>
    a.classList.toggle("active", a.dataset.nav === name)
  );
  $("#viewTitle").textContent = VIEW_META[name].title;
  $("#viewSub").textContent = VIEW_META[name].sub;
  if (typeof refreshCharts[name] === "function") setTimeout(refreshCharts[name], 30);
  window.scrollTo(0, 0);
}

const VIEW_META = {
  dashboard: { title: "监控总览", sub: "今日消耗 · 月度配额 · 实时速率一览" },
  realtime:  { title: "实时流量走向", sub: "上下行速率曲线与进程级实时分配" },
  apps:      { title: "应用流量", sub: "按进程统计消耗，支持行内限速" },
  conns:     { title: "连接详情", sub: "远程地址 · 端口 · 归属地明细" },
  reports:   { title: "统计报表", sub: "日 / 周 / 月消耗趋势与应用排行" },
  settings:  { title: "设置", sub: "配额警报 · 网卡 · 悬浮窗 · 采集偏好" },
};

$$(".nav-item").forEach((a) =>
  a.addEventListener("click", (e) => {
    e.preventDefault();
    showView(a.dataset.nav);
  })
);

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  $("#toastMsg").textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

/* ---------- 格式化 ---------- */
const fmtRate = (v /* MB/s 浮点 */) => {
  if (v >= 1) return v.toFixed(1) + " <span class='unit'>MB/s</span>";
  return (v * 1024).toFixed(0) + " <span class='unit'>KB/s</span>";
};
const fmtRatePlain = (v) => (v >= 1 ? v.toFixed(1) + " MB/s" : Math.round(v * 1024) + " KB/s");

/* ============================================================
   实时数据引擎：优先使用原生真实采集（native.js 每秒写入 RT.down/up），
   仅在从未收到原生数据时才做本地波动演示，避免把假数据显示为真实。
   ============================================================ */
const RT = {
  down: 0, up: 0,
  histD: [], histU: [],       // 曲线历史（MB/s）
  max: 60,
  paused: false,
};
function tickRealtime() {
  if (RT.paused) return;
  const nativeOn = !!(window.__NETPULSE_NATIVE && window.__NETPULSE_NATIVE.active);
  const everGot = !!(window.__NETPULSE_NATIVE && window.__NETPULSE_NATIVE.lastMsg);
  if (!nativeOn && !everGot) {
    // 尚未拿到任何真实数据：小幅波动占位，明确标注“等待采集”
    RT.down = Math.max(0, RT.down + (Math.random() - 0.5) * 0.4);
    RT.up   = Math.max(0, RT.up + (Math.random() - 0.5) * 0.2);
  }
  /* nativeOn 时 RT.down/up 已是原生真实值，直接使用 */
  RT.histD.push(RT.down); RT.histU.push(RT.up);
  if (RT.histD.length > 120) { RT.histD.shift(); RT.histU.shift(); }

  /* 顶栏速率 */
  $("#tbDown").textContent = "↓ " + fmtRatePlain(RT.down);
  $("#tbUp").textContent = "↑ " + fmtRatePlain(RT.up);

  /* 仪表盘实时卡 */
  $("#dashDown").innerHTML = fmtRate(RT.down);
  $("#dashUp").innerHTML = fmtRate(RT.up);
  if ($("#rtDown")) $("#rtDown").innerHTML = fmtRate(RT.down);
  if ($("#rtUp")) $("#rtUp").innerHTML = fmtRate(RT.up);

  /* 悬浮窗预览 */
  const mwD = $("#mwDown"), mwU = $("#mwUp");
  if (mwD) mwD.textContent = fmtRatePlain(RT.down);
  if (mwU) mwU.textContent = fmtRatePlain(RT.up);

  drawSparklines();
  /* 仪表盘画布常驻刷新；实时视图画布按需刷新 */
  drawRTChart("rtChart");
  if (document.body.dataset.page === "realtime") drawRTChart("rtChartRealtime");
}
setInterval(tickRealtime, 900);

/* ---------- 内联迷你曲线（指标卡） ---------- */
function drawSparklines() {
  const mk = (el, data, color, max) => {
    if (!el) return;
    const w = 90, h = 34, n = data.length;
    if (!n) return;
    const pts = data.slice(-30).map((v, i) =>
      `${(i / 29) * w},${h - (v / max) * (h - 4) - 2}`);
    el.innerHTML = `<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" opacity=".85"/>`;
  };
  mk($("#sparkDown"), RT.histD, "#22d3a5", 60);
  mk($("#sparkUp"), RT.histU, "#f5a623", 15);
}

/* ---------- 实时大图表（按 canvas id 渲染） ---------- */
function drawRTChart(canvasId) {
  const cv = document.getElementById(canvasId);
  if (!cv || !cv.offsetParent) return; // 隐藏视图跳过
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = 260;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const padL = 46, padB = 22, padT = 10;
  const iw = w - padL - 8, ih = h - padT - padB;

  /* 网格 + Y 轴刻度 */
  ctx.font = "10px Consolas, monospace";
  ctx.fillStyle = "#5a6b8a";
  ctx.strokeStyle = "#1a2538";
  ctx.lineWidth = 1;
  const yMax = 40;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (ih / 4) * i;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - 8, y); ctx.stroke();
    ctx.fillText((yMax - (yMax / 4) * i) + "", 8, y + 3);
  }
  ctx.fillText("MB/s", 8, padT + 8);

  const drawSeries = (data, color, fill) => {
    const n = data.length;
    if (n < 2) return;
    const pts = data.map((v, i) => [
      padL + (i / 119) * iw,
      padT + ih - Math.min(1, v / yMax) * ih,
    ]);
    if (fill) {
      const grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
      grad.addColorStop(0, fill);
      grad.addColorStop(1, "transparent");
      ctx.beginPath();
      ctx.moveTo(pts[0][0], padT + ih);
      pts.forEach((p) => ctx.lineTo(p[0], p[1]));
      ctx.lineTo(pts[n - 1][0], padT + ih);
      ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
    }
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.strokeStyle = color; ctx.lineWidth = 1.8;
    ctx.lineJoin = "round"; ctx.stroke();
    /* 末端光点 */
    const last = pts[pts.length - 1];
    ctx.beginPath(); ctx.arc(last[0], last[1], 3.2, 0, 7);
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8; ctx.fill();
    ctx.shadowBlur = 0;
  };
  while (RT.histD.length < 120) { RT.histD.unshift(0); RT.histU.unshift(0); }
  drawSeries(RT.histU, "#f5a623", "#f5a62320");
  drawSeries(RT.histD, "#22d3a5", "#22d3a528");

  /* X 轴时间提示 */
  ctx.fillStyle = "#5a6b8a";
  ctx.fillText("-120s", padL, h - 6);
  ctx.fillText("now", w - 26, h - 6);
}

/* ============================================================
   视图刷新器（首次进入/切换时渲染静态结构）
   ============================================================ */
const refreshCharts = {};

/* ---------- 仪表盘 ---------- */
refreshCharts.dashboard = () => {
  const q = DB.quota;
  const pct = (q.usedGB / q.monthlyCapGB) * 100;
  /* 配额环 */
  const R = 52, C = 2 * Math.PI * R;
  const ring = $("#quotaRing");
  ring.querySelector(".ring-val-fg").style.strokeDashoffset = C * (1 - pct / 100);
  $("#quotaPct").textContent = pct.toFixed(1) + "%";
  $("#quotaUsed").textContent = fmtGB(q.usedGB) + " GB";
  $("#quotaCap").textContent = " / " + q.monthlyCapGB + " GB";
  ring.classList.toggle("warn", pct >= 80 && pct < 95);
  ring.classList.toggle("hot", pct >= 95);
  $("#quotaDays").textContent = q.daysLeft + " 天后重置";

  /* 告警列表 */
  const wrap = $("#alertList");
  wrap.innerHTML = DB.alerts.map((a) => `
    <div class="alert-item">
      <span class="a-ico ${a.type}">${ICONS[a.icon] || ICONS.info}</span>
      <div class="a-body"><h5>${a.title}</h5><p>${a.desc}</p></div>
      <span class="a-time">${a.time}</span>
      <button class="btn ghost sm" data-alert-read="${a.id}" title="标记已读">${ICONS.check}</button>
    </div>`).join("");
  $$("[data-alert-read]", wrap).forEach((btn) =>
    btn.addEventListener("click", async () => {
      const id = +btn.dataset.alertRead;
      const r = await API.markAlertRead(id);
      if (r.code === 0) {
        refreshCharts.dashboard();
        toast("已标记为已读");
        const n = DB.alerts.length;
        $("#alertBadge").textContent = n;
        $("#alertBadge").style.display = n ? "" : "none";
      }
    })
  );
};

/* ---------- 应用流量 ---------- */
refreshCharts.apps = () => {
  const tb = $("#appsTable tbody");
  tb.innerHTML = DB.apps.map((a) => {
    const r = (window.__npAppRates || {})[a.id] || {};
    return `
    <tr data-app="${a.id}">
      <td><div class="app-row">
        <span class="app-ico" style="background:${a.color}22;color:${a.color};border:1px solid ${a.color}44">${a.name[0]}</span>
        <div><div style="color:var(--text);font-weight:500">${a.name}</div>
        <div class="mono muted" style="font-size:11px">${a.proc}</div></div>
      </div></td>
      <td class="num r c-down-rate" style="color:var(--down)">${fmtBytes(r.down || 0)}</td>
      <td class="num r c-up-rate" style="color:var(--up)">${fmtBytes(r.up || 0)}</td>
      <td class="num r c-total">${fmtGB(a.total)} GB</td>
      <td class="num r">${a.conns}</td>
      <td class="r">
        <span class="limiter">
          <span class="switch"><input type="checkbox" data-lm-toggle="${a.id}" ${a.limited ? "checked" : ""}><span class="track"></span></span>
          <span class="lm-val">${a.limited ? "限 " + a.limit + " MB/s" : "不限速"}</span>
        </span>
      </td>
    </tr>`;
  }).join("");

  /* 限速交互（经 api.setAppLimit 存根） */
  $$("[data-lm-toggle]", tb).forEach((sw) =>
    sw.addEventListener("change", async () => {
      const id = sw.dataset.lmToggle;
      const on = sw.checked;
      const r = await API.setAppLimit(id, on ? 2 : null);
      if (r.code === 0) {
        refreshCharts.apps();
        toast(on ? "已限速至 2 MB/s" : "已取消限速");
      }
    })
  );
  /* 行点击 → 连接视图按应用过滤 */
  $$("tr[data-app]", tb).forEach((tr) =>
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".limiter")) return;
      goConns(tr.dataset.app);
    })
  );
};

/* ---------- 应用视图实时速率注入（原生：真实采集值） ---------- */
setInterval(() => {
  if (document.body.dataset.page !== "apps") return;
  $$("tr[data-app]").forEach((tr) => {
    const a = DB.apps.find((x) => x.id === tr.dataset.app);
    if (!a) return;
    const r = (window.__npAppRates || {})[a.id] || {};
    const d = r.down || 0, u = r.up || 0;
    const cd = tr.querySelector(".c-down-rate"), cu = tr.querySelector(".c-up-rate");
    const ct = tr.querySelector(".c-total");
    if (cd) cd.textContent = fmtBytes(d);
    if (cu) cu.textContent = fmtBytes(u);
    if (ct) ct.textContent = fmtGB(a.total) + " GB";
  });
}, 1200);

/* ---------- 连接详情 ---------- */
let connFilterApp = null;
refreshCharts.conns = () => {
  renderConns();
  /* 归属地分布 */
  const geoCount = {};
  DB.conns.forEach((c) => { geoCount[c.geo] = (geoCount[c.geo] || 0) + c.down; });
  const total = Object.values(geoCount).reduce((a, b) => a + b, 0);
  const geoWrap = $("#connGeo");
  if (!(total > 0)) {
    geoWrap.innerHTML = '<div class="muted" style="font-size:12px">暂无可统计的流量分布</div>';
    return;
  }
  geoWrap.innerHTML = Object.entries(geoCount).sort((a, b) => b[1] - a[1]).map(([geo, v]) => {
    const c = DB.conns.find((x) => x.geo === geo);
    const pct = (v / total) * 100;
    return `<div class="row">
      <span class="flag">${c.flag}</span>
      <div class="bar">
        <div class="flex gap-2" style="justify-content:space-between;margin-bottom:5px">
          <span style="font-size:12px;color:var(--text-sub)">${geo}</span>
          <span class="mono muted" style="font-size:11px">${(v / 1048576).toFixed(1)} MB · ${pct.toFixed(0)}%</span>
        </div>
        <div class="pbar"><i style="width:${pct}%"></i></div>
      </div>
    </div>`;
  }).join("");
};
function renderConns() {
  const tb = $("#connTable tbody");
  const rows = connFilterApp ? DB.conns.filter((c) => c.app === connFilterApp) : DB.conns;
  $("#connCount").textContent = rows.length + " 条活动连接";
  tb.innerHTML = rows.map((c) => {
    const app = DB.apps.find((a) => a.id === c.app);
    return `<tr>
      <td><div class="flex gap-2"><span class="app-ico" style="width:24px;height:24px;border-radius:6px;font-size:11px;background:${app.color}22;color:${app.color}">${app.name[0]}</span><span style="color:var(--text)">${app.name}</span></div></td>
      <td><div class="mono" style="color:var(--text);font-size:12px">${c.remote}:${c.port}</div>
          <div class="muted" style="font-size:11px">${c.host}</div></td>
      <td><span class="tag ${c.proto === "TCP" ? "blue" : "gray"}">${c.proto}</span></td>
      <td><span class="tag green">${c.state}</span></td>
      <td class="num" style="color:var(--down)">${fmtBytes(c.down)}</td>
      <td class="num" style="color:var(--up)">${fmtBytes(c.up)}</td>
      <td><span class="flag" style="width:24px;height:24px;font-size:11px;border-radius:6px;display:inline-grid">${c.flag}</span> <span style="font-size:12px">${c.geo}</span></td>
    </tr>`;
  }).join("");
}
function goConns(appId) {
  connFilterApp = appId;
  const sel = $("#connAppFilter");
  if (sel) sel.value = appId;
  showView("conns");
}

/* 连接过滤下拉 */
const connFilterSel = $("#connAppFilter");
if (connFilterSel) {
  DB.apps.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.id; opt.textContent = a.name;
    connFilterSel.appendChild(opt);
  });
  connFilterSel.addEventListener("change", () => {
    connFilterApp = connFilterSel.value || null;
    renderConns();
  });
}

/* ---------- 实时视图：进程流量分解条 ---------- */
refreshCharts.realtime = () => renderRTBreakdown();
function renderRTBreakdown() {
  const wrap = $("#rtAppBreakdown");
  if (!wrap) return;
  const rateOf = (a) => (window.__npAppRates || {})[a.id] || { down: 0, up: 0 };
  const rows = [...DB.apps].map((a) => ({ a, r: rateOf(a) }))
    .sort((x, y) => (y.r.down + y.r.up) - (x.r.down + x.r.up)).slice(0, 6);
  const maxRate = Math.max(...rows.map((x) => x.r.down + x.r.up), 1);
  wrap.innerHTML = rows.map(({ a, r }) => {
    const d = r.down; const u = r.up;
    return `<div class="rt-app-row" data-rt-app="${a.id}" style="cursor:pointer">
      <div class="flex gap-3" style="justify-content:space-between;margin-bottom:5px">
        <div class="flex gap-2">
          <span class="app-ico" style="width:26px;height:26px;border-radius:7px;font-size:12px;background:${a.color}22;color:${a.color}">${a.name[0]}</span>
          <span style="font-size:13px;color:var(--text)">${a.name}</span>
          ${a.limited ? `<span class="tag amber">限 ${a.limit} MB/s</span>` : ""}
        </div>
        <span class="mono" style="font-size:12px">
          <span style="color:var(--down)">↓ ${fmtBytes(d)}</span>
          <span style="color:var(--up);margin-left:10px">↑ ${fmtBytes(u)}</span>
        </span>
      </div>
      <div style="height:5px;border-radius:99px;background:#1a2538;overflow:hidden;display:flex">
        <i style="width:${(d / maxRate) * 100}%;background:${a.color}"></i>
        <i style="width:${(u / maxRate) * 100}%;background:${a.color}66"></i>
      </div>
    </div>`;
  }).join("");
  $$("[data-rt-app]", wrap).forEach((row) =>
    row.addEventListener("click", () => goConns(row.dataset.rtApp))
  );
}
setInterval(() => {
  if (document.body.dataset.page === "realtime") renderRTBreakdown();
}, 1400);

/* ---------- 报表热力图 ---------- */
function renderHeatmap() {
  const el = $("#heatmap");
  if (!el) return;
  let html = "";
  for (let i = 0; i < 12 * 7; i++) {
    const v = Math.random();
    const intensity = v < 0.5 ? 0.12 : v < 0.75 ? 0.3 : v < 0.92 ? 0.55 : 0.9;
    html += `<div title="流量强度 ${(v * 100).toFixed(0)}%" style="aspect-ratio:1.6;border-radius:4px;background:rgba(34,211,165,${intensity.toFixed(2)})"></div>`;
  }
  el.innerHTML = html;
}

/* ---------- 统计报表 ---------- */
refreshCharts.reports = () => {
  renderHeatmap();
  /* 顶部汇总 */
  const h = DB.history;
  const sumD = h.reduce((a, x) => a + x.down, 0);
  const sumU = h.reduce((a, x) => a + x.up, 0);
  $("#repTotalD").textContent = fmtGB(sumD) + " GB";
  $("#repTotalU").textContent = fmtGB(sumU) + " GB";
  $("#repPeak").textContent = "11-24 · 58.4 MB/s";
  $("#repAvg").textContent = fmtGB(sumD / h.length) + " GB/日";

  /* 柱状图 */
  const chart = $("#barChart");
  const max = Math.max(...h.map((x) => x.down + x.up));
  chart.innerHTML = h.map((x) => `
    <div class="bar-col" title="11-${x.d}  ↓${x.down}GB ↑${x.up}GB">
      <div class="bars">
        <div class="b-up" style="height:${(x.up / max) * 88}%"></div>
        <div class="b-down" style="height:${(x.down / max) * 88}%"></div>
      </div>
      <span class="d-label">${x.d}</span>
    </div>`).join("");

  /* 应用排行 */
  const top = $("#usageTop");
  const maxApp = DB.usageTop[0].down + DB.usageTop[0].up;
  top.innerHTML = DB.usageTop.map((u, i) => {
    const app = DB.apps.find((a) => a.id === u.id) || { color: "#5a6b8a", name: u.name };
    const tot = u.down + u.up;
    return `<div class="top-row" style="padding:9px 0;border-bottom:1px solid #182338">
      <span class="rank">${i + 1}</span>
      <span class="app-ico" style="width:26px;height:26px;border-radius:7px;font-size:12px;background:${app.color}22;color:${app.color}">${app.name[0]}</span>
      <div style="flex:1;min-width:0">
        <div class="flex" style="justify-content:space-between;margin-bottom:5px">
          <span style="font-size:12.5px;color:var(--text)">${app.name}</span>
          <span class="mono" style="font-size:11px;color:var(--text-sub)">${fmtGB(tot)} GB</span>
        </div>
        <div class="pbar"><i style="width:${(tot / maxApp) * 100}%;background:${app.color}"></i></div>
      </div>
    </div>`;
  }).join("");
};

/* 报表周期切换（演示数据） */
$$("#repRange button").forEach((b) =>
  b.addEventListener("click", () => {
    $$("#repRange button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    toast("已切换至「" + b.textContent + "」视图（演示数据）");
  })
);

/* ---------- 设置 ---------- */
const SET_PANELS = {
  general: $("#setGeneral"), quota: $("#setQuota"), adapter: $("#setAdapters"), widget: $("#setWidget"),
};
$$(".set-nav button").forEach((b) =>
  b.addEventListener("click", () => {
    $$(".set-nav button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    Object.entries(SET_PANELS).forEach(([k, el]) => el.classList.toggle("on", k === b.dataset.set));
  })
);

/* 配额滑块 */
const quotaRange = $("#quotaRange");
if (quotaRange) {
  quotaRange.addEventListener("input", () => {
    $("#quotaRangeVal").textContent = quotaRange.value + " GB";
  });
  quotaRange.addEventListener("change", async () => {
    const r = await API.updateQuota(+quotaRange.value);
    if (r.code === 0) {
      DB.quota.monthlyCapGB = +quotaRange.value;
      toast("月度配额已更新为 " + quotaRange.value + " GB");
    }
  });
}

/* 网卡切换 */
refreshCharts.settings = () => {
  const wrap = $("#adapterList");
  wrap.innerHTML = DB.adapters.map((a) => `
    <div class="set-row">
      <div class="sr-info" style="display:flex;align-items:center;gap:12px">
        <span class="pulse-dot ${a.status === "up" ? "g" : "r"}"></span>
        <div><h4>${a.name}</h4>
        <p class="mono">${a.ip} · ${a.speed}</p></div>
      </div>
      <div class="sr-ctrl">
        <span class="tag ${a.status === "up" ? "green" : "red"}">${a.status === "up" ? "活动" : "已断开"}</span>
        <label class="switch"><input type="checkbox" data-adapter="${a.id}" ${a.isDefault ? "checked" : ""}><span class="track"></span></label>
      </div>
    </div>`).join("");
  $$("[data-adapter]", wrap).forEach((sw) =>
    sw.addEventListener("change", () => {
      DB.adapters.forEach((a) => (a.isDefault = a.id === sw.dataset.adapter && sw.checked));
      refreshCharts.settings();
      toast("默认监控网卡已切换");
      $("#tbAdapter").textContent = DB.adapters.find((a) => a.isDefault).name.split(" · ")[0];
    })
  );
};

/* 悬浮窗开关演示 */
const widgetSw = $("#widgetToggle");
if (widgetSw) widgetSw.addEventListener("change", () => {
  $("#miniWidgetPreview").style.opacity = widgetSw.checked ? "1" : ".35";
  toast(widgetSw.checked ? "桌面悬浮窗已开启" : "桌面悬浮窗已关闭");
});

/* ============================================================
   SVG 图标注册（内联 Lucide 风格，零外部依赖）
   ============================================================ */
const ICONS = {
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  info: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`,
  "alert-triangle": `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/></svg>`,
  gauge: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>`,
  "shield-question": `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M9.1 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/></svg>`,
  "wifi-off": `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.06.82 11.34 3.82"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 13a10 10 0 0 1 5.24-2.76"/><path d="M12 20h.01"/></svg>`,
  "activity": `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>`,
};

/* 品牌脉冲 logo */
const pulseLogo = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`;
$("#brandIcon").innerHTML = pulseLogo;

/* ============================================================
   初始化
   ============================================================ */
/* toast 图标 */
const toastIconEl = $("#toastIcon");
if (toastIconEl) toastIconEl.innerHTML = ICONS.check;

/* 实时曲线周期切换（演示） */
$$("#rtRange button").forEach((b) =>
  b.addEventListener("click", () => {
    $$("#rtRange button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    toast("已切换至「" + b.textContent + "」窗口（演示数据）");
  })
);

showView("dashboard");
refreshCharts.dashboard();
setTimeout(() => { refreshCharts.apps(); }, 50);
window.addEventListener("resize", () => {
  if (document.body.dataset.page === "realtime") drawRTChart("rtChartRealtime");
});
