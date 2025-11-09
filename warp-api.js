// Warp Account Manager - Surge 内置本地 API
// 通过拦截 warp.local/* 请求，提供 REST 风格接口
// 持久化使用 $persistentStore，无需额外 Python 服务

const STORAGE_KEY_PREFIX = "warp_manager_";
const ACTIVE_EMAIL_KEY = STORAGE_KEY_PREFIX + "active_email";
const ACCOUNTS_KEY = STORAGE_KEY_PREFIX + "accounts"; // [{ email, token, health_status, last_updated }]

function nowISO() {
  const d = new Date();
  const pad = (n) => (n < 10 ? "0" + n : n);
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes()) +
    ":" +
    pad(d.getSeconds())
  );
}

function readStore(key, defVal = null) {
  const raw = $persistentStore.read(key);
  if (raw === undefined || raw === null) return defVal;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function writeStore(key, val) {
  const data = typeof val === "string" ? val : JSON.stringify(val);
  return $persistentStore.write(data, key);
}

function jsonResponse(obj, status = 200, headers = {}) {
  const body = JSON.stringify(obj);
  $done({
    response: {
      status,
      headers: Object.assign(
        {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
        headers
      ),
      body,
    },
  });
}

function emptyResponse(status = 200, headers = {}) {
  $done({
    response: {
      status,
      headers: Object.assign(
        {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
        headers
      ),
      body: "",
    },
  });
}

function badRequest(msg) {
  jsonResponse({ success: false, error: msg }, 400);
}

function notFound(msg = "未找到接口") {
  jsonResponse({ success: false, error: msg }, 404);
}

async function handleOptions() {
  emptyResponse(200);
}

function parseBody() {
  try {
    if (!$request || !$request.body) return {};
    return JSON.parse($request.body);
  } catch (e) {
    return {};
  }
}

function getAccounts() {
  const arr = readStore(ACCOUNTS_KEY, []);
  if (Array.isArray(arr)) return arr;
  return [];
}

function saveAccounts(arr) {
  if (!Array.isArray(arr)) return false;
  return writeStore(ACCOUNTS_KEY, arr);
}

function getActiveEmail() {
  return readStore(ACTIVE_EMAIL_KEY, null);
}

function setActiveEmail(email) {
  return writeStore(ACTIVE_EMAIL_KEY, email || "");
}

function route() {
  const url = $request.url; // e.g., http://warp.local/accounts
  const u = new URL(url);
  const path = u.pathname; // /accounts
  const method = ($request.method || "GET").toUpperCase();

  if (method === "OPTIONS") return handleOptions();

  // GET /accounts
  if (method === "GET" && path === "/accounts") {
    const active = getActiveEmail();
    const list = getAccounts();
    const resp = list
      .slice()
      .sort((a, b) => (b.last_updated || "").localeCompare(a.last_updated || ""))
      .map((acc) => ({
        email: acc.email,
        is_active: acc.email === active ? 1 : 0,
        is_banned: acc.health_status === "banned" ? 1 : 0,
        last_used: acc.last_updated || null,
        has_token: acc.token ? 1 : 0,
        health_status: acc.health_status || "healthy",
      }));
    return jsonResponse({ success: true, accounts: resp });
  }

  // GET /active-account
  if (method === "GET" && path === "/active-account") {
    const active = getActiveEmail();
    const list = getAccounts();
    let target = list.find((a) => a.email === active && a.health_status !== "banned");
    if (!target) {
      target = list.find((a) => a.health_status !== "banned");
    }
    if (!target) return notFound("没有找到活跃账号");
    if (!target.token) return notFound("活跃账号没有 token");
    return jsonResponse({
      success: true,
      email: target.email,
      token: target.token,
      last_used: target.last_updated || null,
    });
  }

  // GET /stats
  if (method === "GET" && path === "/stats") {
    const active = getActiveEmail();
    const list = getAccounts();
    const total = list.length;
    const banned = list.filter((a) => a.health_status === "banned").length;
    const available = list.filter((a) => a.health_status !== "banned").length;
    const has_active = active ? 1 : 0;
    return jsonResponse({ success: true, total, banned, available, active: has_active });
  }

  // POST bodies
  const body = parseBody();

  // POST /switch-account
  if (method === "POST" && path === "/switch-account") {
    const list = getAccounts();
    if (list.length === 0) return notFound("没有可用的账号");
    const current = getActiveEmail();
    const candidates = list
      .filter((a) => a.health_status !== "banned" && a.email !== (current || ""))
      .sort((a, b) => (a.last_updated || "").localeCompare(b.last_updated || ""));
    const next = candidates[0] || null;
    if (!next) return notFound("没有可用的账号");
    if (!next.token) return notFound("下一个账号没有 token");

    setActiveEmail(next.email);
    next.last_updated = nowISO();
    saveAccounts(list);

    return jsonResponse({ success: true, email: next.email, token: next.token, message: `已切换到账号: ${next.email}` });
  }

  // POST /activate-account
  if (method === "POST" && path === "/activate-account") {
    const email = body.email;
    if (!email) return badRequest("缺少 email 参数");
    const list = getAccounts();
    const target = list.find((a) => a.email === email && a.health_status !== "banned");
    if (!target) return notFound("账号不存在或已被 ban");
    if (!target.token) return notFound("账号没有 token");

    setActiveEmail(email);
    target.last_updated = nowISO();
    saveAccounts(list);

    return jsonResponse({ success: true, email, token: target.token, message: `已激活账号: ${email}` });
  }

  // POST /ban-account
  if (method === "POST" && path === "/ban-account") {
    const email = body.email;
    if (!email) return badRequest("缺少 email 参数");
    const list = getAccounts();
    const target = list.find((a) => a.email === email);
    if (!target) return notFound("账号不存在");
    target.health_status = "banned";
    if (getActiveEmail() === email) setActiveEmail("");
    saveAccounts(list);
    return jsonResponse({ success: true, message: `账号 ${email} 已标记为 banned` });
  }

  // POST /add-account
  if (method === "POST" && path === "/add-account") {
    const email = body.email;
    const token = body.token;
    if (!email || !token) return badRequest("缺少 email 或 token 参数");
    const list = getAccounts();
    const existing = list.find((a) => a.email === email);
    if (existing) {
      existing.token = token;
      existing.last_updated = nowISO();
    } else {
      list.push({ email, token, health_status: "healthy", last_updated: nowISO() });
    }
    saveAccounts(list);
    return jsonResponse({ success: true, message: existing ? `账号 ${email} 的 token 已更新` : `账号 ${email} 已添加` });
  }

  // POST /delete-account
  if (method === "POST" && path === "/delete-account") {
    const email = body.email;
    if (!email) return badRequest("缺少 email 参数");
    let list = getAccounts();
    const before = list.length;
    list = list.filter((a) => a.email !== email);
    saveAccounts(list);
    if (getActiveEmail() === email) setActiveEmail("");
    if (list.length === before) return notFound("账号不存在");
    return jsonResponse({ success: true, message: `账号 ${email} 已删除` });
  }

  // 未匹配
  notFound();
}

route();
