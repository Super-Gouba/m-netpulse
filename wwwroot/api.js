/* ============================================================
   M-NetPulse · api.js — API 存根层
   签名即未来真实 API 的形态；当前内部返回 mock。
   TODO: replace with fetch('/api/...') — 保持返回结构不变
   ============================================================ */

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET /api/realtime  → 实时速率快照
 * 返回 { downBps, upBps, downTotal, upTotal, adapter }
 * 当前实现：叠加随机波动生成演示数据
 */
async function fetchRealtime(prev = { down: 5, up: 1 }) {
  const jitter = (base, spread, min = 0.2) =>
    Math.max(min, base + (Math.random() - 0.5) * spread);
  return {
    down: jitter(prev.down, prev.down * 0.5),
    up: jitter(prev.up, prev.up * 0.4),
  };
}

/**
 * GET /api/connections?state=established
 * 返回 { code: 0, data: DB.conns }
 */
async function fetchConnections() {
  await delay(200);
  return { code: 0, data: DB.conns };
}

/**
 * GET /api/apps
 * 返回 { code: 0, data: DB.apps }
 */
async function fetchApps() {
  await delay(150);
  return { code: 0, data: DB.apps };
}

/**
 * POST /api/apps/:id/limit  { downLimitMBs | null }
 * 设置进程限速；limit 为 null 表示取消限速
 * 返回 { code: 0 }
 */
async function setAppLimit(appId, limitMBs) {
  await delay(300);
  const app = DB.apps.find((a) => a.id === appId);
  if (!app) return { code: 404, msg: "app not found" };
  app.limit = limitMBs;
  app.limited = limitMBs != null;
  return { code: 0 };
}

/**
 * POST /api/quota  { capGB }
 * 更新月度套餐上限
 */
async function updateQuota(capGB) {
  await delay(250);
  DB.quota.monthlyCapGB = capGB;
  return { code: 0 };
}

/**
 * GET /api/history?range=day|week|month
 * 返回 { code: 0, data: DB.history }
 */
async function fetchHistory() {
  await delay(180);
  return { code: 0, data: DB.history };
}

/**
 * POST /api/alerts/:id/read
 */
async function markAlertRead(id) {
  await delay(150);
  DB.alerts = DB.alerts.filter((a) => a.id !== id);
  return { code: 0 };
}

if (typeof window !== "undefined") {
  window.API = { fetchRealtime, fetchConnections, fetchApps, setAppLimit, updateQuota, fetchHistory, markAlertRead };
}
