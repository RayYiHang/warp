// Warp Account Manager - Surge Module Script
// 基于原 Python 脚本逻辑的 JavaScript 实现

const STORAGE_KEY_PREFIX = "warp_manager_";
const ACTIVE_EMAIL_KEY = STORAGE_KEY_PREFIX + "active_email";
const ACTIVE_TOKEN_KEY = STORAGE_KEY_PREFIX + "active_token";
const ACCOUNTS_KEY = STORAGE_KEY_PREFIX + "accounts";
const SETTINGS_CACHE_KEY = STORAGE_KEY_PREFIX + "settings_cache";
const LAST_TOKEN_CHECK_KEY = STORAGE_KEY_PREFIX + "last_token_check";
const DB_API_URL = "http://127.0.0.1:8888"; // 本地数据库 API

// 工具函数
function log(emoji, message) {
  const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  console.log(`[${timestamp}] ${emoji} ${message}`);
}

// 从持久化存储读取数据
function getStorageData(key, defaultValue = null) {
  const value = $persistentStore.read(key);
  if (value === undefined || value === null) {
    return defaultValue;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// 写入持久化存储
function setStorageData(key, value) {
  const data = typeof value === "string" ? value : JSON.stringify(value);
  $persistentStore.write(data, key);
}

// 从数据库 API 获取账号列表
async function fetchAccountsFromDB() {
  try {
    const response = await $httpClient.get({
      url: `${DB_API_URL}/accounts`,
      timeout: 5,
    });

    if (response.status === 200) {
      const accounts = JSON.parse(response.body);
      setStorageData(ACCOUNTS_KEY, accounts);
      log("📦", `从数据库加载了 ${accounts.length} 个账号`);
      return accounts;
    }
  } catch (error) {
    log("❌", `获取账号列表失败: ${error}`);
  }

  // 失败时返回缓存
  return getStorageData(ACCOUNTS_KEY, []);
}

// 获取活跃账号的 token
async function getActiveToken() {
  let activeEmail = getStorageData(ACTIVE_EMAIL_KEY);
  let activeToken = getStorageData(ACTIVE_TOKEN_KEY);

  // 如果没有活跃账号，尝试从数据库获取
  if (!activeEmail || !activeToken) {
    try {
      const response = await $httpClient.get({
        url: `${DB_API_URL}/active-account`,
        timeout: 5,
      });

      if (response.status === 200) {
        const data = JSON.parse(response.body);
        activeEmail = data.email;
        activeToken = data.token;

        setStorageData(ACTIVE_EMAIL_KEY, activeEmail);
        setStorageData(ACTIVE_TOKEN_KEY, activeToken);

        log("🔑", `加载活跃账号: ${activeEmail}`);
      }
    } catch (error) {
      log("❌", `获取活跃账号失败: ${error}`);
      return null;
    }
  }

  return { email: activeEmail, token: activeToken };
}

// 切换到下一个可用账号
async function switchToNextAccount() {
  try {
    const response = await $httpClient.post({
      url: `${DB_API_URL}/switch-account`,
      timeout: 5,
    });

    if (response.status === 200) {
      const data = JSON.parse(response.body);
      setStorageData(ACTIVE_EMAIL_KEY, data.email);
      setStorageData(ACTIVE_TOKEN_KEY, data.token);

      log("🔄", `切换到账号: ${data.email}`);
      return true;
    }
  } catch (error) {
    log("❌", `切换账号失败: ${error}`);
  }
  return false;
}

// 标记账号为已 ban
async function markAccountBanned(email) {
  try {
    await $httpClient.post({
      url: `${DB_API_URL}/ban-account`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email }),
      timeout: 5,
    });
    log("⛔", `账号已标记为 banned: ${email}`);

    // 自动切换到下一个账号
    await switchToNextAccount();
  } catch (error) {
    log("❌", `标记 ban 失败: ${error}`);
  }
}

// 生成随机 Experiment ID
function generateExperimentId() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 22; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ============ 请求拦截 ============
async function handleRequest(request) {
  const url = request.url;
  const host = request.headers.Host || "";

  // 过滤非 Warp 请求
  if (!host.includes("warp.dev")) {
    return request;
  }

  // 阻止 Rudderstack 追踪
  if (host.includes("dataplane.rudderstack.com")) {
    log("🚫", `阻止 Rudderstack 请求: ${url}`);
    return {
      status: 204,
      headers: { "Content-Type": "text/plain" },
      body: "",
    };
  }

  log("🌐", `Warp 请求: ${request.method} ${url}`);

  // 获取活跃账号的 token
  const account = await getActiveToken();
  if (account && account.token) {
    const oldAuth = request.headers.Authorization || "无";
    request.headers.Authorization = `Bearer ${account.token}`;

    log("🔑", `Authorization header 已更新: ${account.email}`);

    if (oldAuth === request.headers.Authorization) {
      log("⚠️", "警告: 新旧 token 相同");
    } else {
      log("✅", `Token 已替换 (末尾: ...${account.token.slice(-20)})`);
    }
  } else {
    log("❌", "未找到活跃 token，无法替换 Authorization");
  }

  // 随机化 Experiment ID
  if (request.headers["X-Warp-Experiment-Id"]) {
    const newExpId = generateExperimentId();
    request.headers["X-Warp-Experiment-Id"] = newExpId;
    log("🧪", `Experiment ID 已随机化`);
  }

  // 检查是否需要更新 token（每分钟检查一次）
  const now = Date.now();
  const lastCheck = getStorageData(LAST_TOKEN_CHECK_KEY, 0);
  if (now - lastCheck > 60000) {
    // 60秒
    log("⏰", "Token 检查时间到，刷新中...");
    await getActiveToken();
    setStorageData(LAST_TOKEN_CHECK_KEY, now);
  }

  return request;
}

// ============ 响应拦截 ============
async function handleResponse(request, response) {
  const url = request.url;
  const status = response.status;

  // 过滤非 Warp 响应
  if (!url.includes("app.warp.dev")) {
    return response;
  }

  log("📡", `Warp 响应: ${status} - ${url}`);

  // 处理 GetUpdatedCloudObjects - 使用缓存的 user_settings
  if (
    url.includes("/graphql/v2?op=GetUpdatedCloudObjects") &&
    request.method === "POST" &&
    status === 200
  ) {
    const cachedSettings = getStorageData(SETTINGS_CACHE_KEY);
    if (cachedSettings) {
      log("🔄", "使用缓存的 user_settings 替换响应");
      response.body = JSON.stringify(cachedSettings);
      response.headers["Content-Type"] = "application/json";
      response.headers["Content-Length"] = response.body.length.toString();
      delete response.headers["Content-Encoding"];
      delete response.headers["Transfer-Encoding"];
      delete response.headers["ETag"];
      log("✅", "GetUpdatedCloudObjects 响应已替换");
    }
  }

  // 检测 403 - 账号被 ban
  if (url.includes("/ai/multi-agent") && status === 403) {
    log("⛔", "检测到 403 FORBIDDEN - 账号已被 ban");
    const account = await getActiveToken();
    if (account && account.email) {
      await markAccountBanned(account.email);
    }
  }

  // 处理 401 - token 失效
  if (status === 401) {
    log("🔄", "收到 401 响应，尝试切换账号...");
    await switchToNextAccount();
  }

  return response;
}

// ============ Cron 定时任务 ============
async function cronTokenCheck() {
  log("⏰", "定时检查 token 有效性");

  const account = await getActiveToken();
  if (!account || !account.token) {
    log("⚠️", "未找到活跃账号，尝试重新加载");
    await fetchAccountsFromDB();
    await getActiveToken();
  } else {
    log("✅", `当前活跃账号: ${account.email}`);
  }
}

// ============ 主入口 ============
(async () => {
  const requestType =
    typeof $request !== "undefined"
      ? "request"
      : typeof $response !== "undefined"
      ? "response"
      : "cron";

  if (requestType === "request") {
    const modifiedRequest = await handleRequest($request);
    $done(modifiedRequest);
  } else if (requestType === "response") {
    const modifiedResponse = await handleResponse($request, $response);
    $done(modifiedResponse);
  } else {
    await cronTokenCheck();
    $done();
  }
})();
