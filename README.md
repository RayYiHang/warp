# Warp Account Manager - Surge 版

基于 Surge + BoxJS 的 Warp AI 多账号管理方案，无需 mitmproxy，与现有 Surge 配置完美共存。

## 🎯 架构设计

```
┌─────────────────┐
│   BoxJS Web UI  │ ← 账号管理界面
└────────┬────────┘
         │
         ↓ HTTP API
┌─────────────────┐
│  warp-db-api.py │ ← 数据库访问层
│  (127.0.0.1:8888)│
└────────┬────────┘
         │
         ↓ SQLite
┌─────────────────┐
│   accounts.db   │ ← 持久化存储
└─────────────────┘
         ↑
         │ Read/Write
┌─────────────────┐
│  Surge Module   │ ← 请求拦截与修改
│ warp-manager.js │
└─────────────────┘
```

## ✨ 功能特性

- ✅ **完全基于 Surge 生态**：无需 mitmproxy 和证书安装
- ✅ **Web 管理界面**：基于 BoxJS 的现代化 UI
- ✅ **自动账号切换**：检测到 ban 或 401 自动切换
- ✅ **Token 自动管理**：定期检查和更新 token
- ✅ **状态实时监控**：账号状态、使用情况一目了然
- ✅ **RESTful API**：支持自动化脚本集成
- ✅ **与 Surge 共存**：不影响现有代理配置

## 📦 文件结构

```
surge-module/
├── warp-account-manager.sgmodule  # Surge 模块配置
├── warp-manager.js                # 核心逻辑脚本
├── warp-db-api.py                 # 数据库 HTTP API
└── boxjs/
    ├── warp-manager.boxjs.json    # BoxJS 配置
    └── accounts-list.html         # Web 管理界面
```

## 🚀 快速开始

### 1. 启动数据库 API 服务

```bash
# 方法 1: 使用启动脚本（推荐）
./start-surge.sh

# 方法 2: 手动启动
python3 surge-module/warp-db-api.py
```

服务将监听在 `http://127.0.0.1:8888`

### 2. 安装 Surge 模块

#### 方法 A: 本地文件安装

1. 打开 Surge
2. 模块 → 安装新模块
3. 粘贴本地路径：
   ```
   /Users/你的用户名/Downloads/warp.dev_account_manager-1/surge-module/warp-account-manager.sgmodule
   ```

#### 方法 B: URL 安装（需要部署到服务器）

```
https://your-domain.com/warp-account-manager.sgmodule
```

### 3. 配置 MITM

在 Surge 配置中确保已启用 MITM 并添加域名：

```ini
[MITM]
hostname = %APPEND% app.warp.dev, *.warp.dev
```

### 4. 访问 Web 管理界面

直接在浏览器打开：
```
file:///Users/你的用户名/Downloads/warp.dev_account_manager-1/surge-module/boxjs/accounts-list.html
```

或者配置到 BoxJS：
1. 打开 BoxJS
2. 订阅 → 添加订阅
3. 粘贴路径：`file:///.../surge-module/boxjs/warp-manager.boxjs.json`

## 📖 使用说明

### 添加账号

**方法 1: 通过 API**
```bash
curl -X POST http://127.0.0.1:8888/add-account \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","token":"your_token_here"}'
```

**方法 2: 通过 Web 界面**
打开管理界面 → 点击"添加账号"按钮

**方法 3: 通过 Swift 应用**
使用原有的 Swift 应用添加（会自动同步到数据库）

### 切换账号

**自动切换**（推荐）：
- 检测到 403（ban）时自动切换
- 检测到 401（token 失效）时自动切换

**手动切换**：
```bash
# 切换到下一个可用账号
curl -X POST http://127.0.0.1:8888/switch-account

# 激活指定账号
curl -X POST http://127.0.0.1:8888/activate-account \
  -H "Content-Type: application/json" \
  -d '{"email":"target@email.com"}'
```

### 查看状态

**Web 界面**：
- 实时显示所有账号状态
- 标识活跃/封禁/token 状态
- 显示最后使用时间

**API 查询**：
```bash
# 获取所有账号
curl http://127.0.0.1:8888/accounts

# 获取活跃账号
curl http://127.0.0.1:8888/active-account

# 获取统计信息
curl http://127.0.0.1:8888/stats
```

## 🔧 配置选项

### Surge Module 配置

在 `warp-manager.js` 顶部修改：

```javascript
const DB_API_URL = "http://127.0.0.1:8888";  // API 地址
```

### 环境变量

通过 `$persistentStore` 配置（可在 BoxJS 中设置）：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `db_api_url` | http://127.0.0.1:8888 | 数据库 API 地址 |
| `auto_switch` | true | 自动切换账号 |
| `block_rudderstack` | true | 阻止追踪请求 |
| `token_check_interval` | 5 | Token 检查间隔（分钟） |
| `debug_mode` | false | 调试模式 |

## 🔌 API 接口文档

### GET /accounts
获取所有账号列表

**响应示例**：
```json
{
  "accounts": [
    {
      "email": "user@example.com",
      "is_active": 1,
      "is_banned": 0,
      "last_used": "2025-11-09 12:00:00",
      "has_token": 1
    }
  ],
  "success": true
}
```

### GET /active-account
获取当前活跃账号

**响应示例**：
```json
{
  "email": "active@example.com",
  "token": "eyJhbGc...",
  "last_used": "2025-11-09 12:00:00",
  "success": true
}
```

### POST /switch-account
切换到下一个可用账号

**响应示例**：
```json
{
  "email": "next@example.com",
  "token": "eyJhbGc...",
  "message": "已切换到账号: next@example.com",
  "success": true
}
```

### POST /activate-account
激活指定账号

**请求体**：
```json
{
  "email": "target@example.com"
}
```

### POST /ban-account
标记账号为 banned

**请求体**：
```json
{
  "email": "banned@example.com"
}
```

### POST /add-account
添加新账号

**请求体**：
```json
{
  "email": "new@example.com",
  "token": "eyJhbGc..."
}
```

### POST /delete-account
删除账号

**请求体**：
```json
{
  "email": "delete@example.com"
}
```

### GET /stats
获取统计信息

**响应示例**：
```json
{
  "total": 10,
  "active": 1,
  "banned": 2,
  "success": true
}
```

## 🐛 调试技巧

### 1. 查看 Surge 日志
Surge → 工具 → 最近请求 → 查看详细日志

### 2. 查看 API 日志
```bash
tail -f ~/Library/Application\ Support/WarpAccountManager/api.log
```

### 3. 启用调试模式
在 `warp-manager.js` 中设置：
```javascript
this.debug = true;  // 启用详细日志
```

### 4. 测试 API 连接
```bash
# 测试服务是否运行
curl http://127.0.0.1:8888/stats

# 检查端口占用
lsof -nP -iTCP:8888 | grep LISTEN
```

## 🆚 对比原 mitmproxy 方案

| 特性 | mitmproxy 方案 | Surge 方案 |
|------|----------------|------------|
| 证书安装 | ✅ 需要 | ❌ 不需要 |
| 性能 | 🟡 中等 | ✅ 原生性能 |
| 与 Surge 共存 | ⚠️ 需配置 | ✅ 完美共存 |
| UI 界面 | 🟡 Swift App | ✅ Web + BoxJS |
| 配置复杂度 | 🟡 中等 | ✅ 简单 |
| 依赖 | Python + mitmproxy | Python (仅 API) |
| 适用场景 | 独立使用 | Surge 用户 |

## 📝 工作原理

### 请求拦截流程

```
1. 用户访问 app.warp.dev
   ↓
2. Surge 拦截请求（warp-request）
   ↓
3. warp-manager.js 执行：
   - 获取活跃账号的 token
   - 替换 Authorization header
   - 随机化 Experiment ID
   ↓
4. 请求发送到 Warp 服务器
```

### 响应拦截流程

```
1. 收到 Warp 服务器响应
   ↓
2. Surge 拦截响应（warp-response）
   ↓
3. warp-manager.js 检查：
   - 403 → 标记账号 banned，自动切换
   - 401 → Token 失效，自动切换
   - GraphQL 响应 → 使用缓存替换
   ↓
4. 返回（修改后的）响应给客户端
```

### Token 自动更新

```
Cron 任务（每 5 分钟）
   ↓
检查活跃账号 token
   ↓
如无效 → 从数据库重新加载
   ↓
更新 $persistentStore
```

## ⚙️ 高级配置

### 自定义 API 端口

修改 `warp-db-api.py`：
```python
if __name__ == '__main__':
    start_api_server(host='127.0.0.1', port=9999)  # 改为其他端口
```

同步修改 `warp-manager.js`：
```javascript
const DB_API_URL = "http://127.0.0.1:9999";
```

### 修改 Token 检查间隔

修改 `warp-account-manager.sgmodule`：
```ini
# 改为每 10 分钟
warp-token-check = type=cron,cronexp="*/10 * * * *",script-path=warp-manager.js
```

### 禁用 Rudderstack 阻止

修改 `warp-manager.js`，注释掉相关代码：
```javascript
// if (host.includes('dataplane.rudderstack.com')) {
//     return { status: 204, ... };
// }
```

## 🔒 安全提示

1. **API 仅本地访问**：默认只监听 127.0.0.1，不对外暴露
2. **Token 存储**：存储在本地 SQLite 数据库，权限 600
3. **HTTPS 流量**：通过 Surge MITM 解密，需信任 Surge 证书
4. **日志文件**：不包含完整 token，仅显示末尾 20 字符

## 🛠️ 故障排除

### 问题 1: API 无法连接

**症状**：Web 界面显示"无法连接到数据库 API"

**解决**：
```bash
# 检查服务是否运行
ps aux | grep warp-db-api

# 检查端口
lsof -nP -iTCP:8888

# 重启服务
./start-surge.sh
```

### 问题 2: Token 未替换

**症状**：Surge 日志显示请求，但 token 未改变

**解决**：
1. 检查 Surge 模块是否启用
2. 确认 MITM 包含 `app.warp.dev`
3. 查看 Surge 日志中的脚本执行结果
4. 确认数据库中有活跃账号

### 问题 3: 403 后未自动切换

**症状**：账号被 ban 后仍使用旧账号

**解决**：
1. 确认配置 `auto_switch = true`
2. 检查是否有其他可用账号
3. 查看 API 日志确认切换请求

## 📚 延伸阅读

- [Surge 模块开发文档](https://manual.nssurge.com/scripting/common.html)
- [BoxJS 使用指南](https://docs.boxjs.app/)
- [SQLite Python API](https://docs.python.org/3/library/sqlite3.html)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可

与主项目相同

---

Made with ❤️ for Warp AI users
