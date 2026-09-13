---
author: JucieOvo
project: modelmayhem
updated: 2026-09-13
---

# Model Mayhem 模型大战魔型

Model Mayhem 是一个面向 AI 开发者社区的开源卡牌对战框架，同时提供
《模型大战魔型》参考规则包、浏览器客户端、对局服务和可接入外部 Agent 的标准工具接口。

项目分为两层：

1. 通用、确定性的卡牌对战框架。
2. Model Mayhem 参考内容、规则、客户端与 Agent 实现。

通用内核不写死现实组织名称。卡牌、技术、模型、组织、行动、世界事件、研究和牌组均放在
`content/` 中，可以替换或扩展。

当前版本是 Alpha 基线。规则、内容和接口仍可能变化，不建议直接用于需要长期兼容性的
商业部署。

## 快速开始

### 环境要求

| 组件 | 要求 | 用途 |
|---|---|---|
| Node.js | 22.22.0 或更高 | 运行服务端、构建客户端和执行脚本 |
| pnpm | 10.34.5 或更高 | 安装依赖和执行工作区命令 |
| Git | 可选，但推荐安装 | 检查、安装和回滚系统内容更新 |
| DeepSeek API Key | 可选 | 启用内置 Pi 对战 Agent |

### Windows 一键启动

在项目根目录双击：

```text
start.cmd
```

首次运行会依次执行以下操作：

1. 检查 Node.js、pnpm、Corepack 或 npx。
2. 根据 `.env.example` 创建本地 `.env`。
3. 在交互式终端中询问 `DEEPSEEK_API_KEY`，直接回车可以跳过。
4. 使用 `pnpm-lock.yaml` 安装锁定依赖。
5. 构建参考 Web 客户端。
6. 启动服务并打开浏览器。

默认地址：

```text
http://127.0.0.1:3210
```

如果没有配置 `DEEPSEEK_API_KEY`，游戏仍可启动和操作玩家回合，但 Agent 回合会明确暂停，
不会伪造 Agent 行动，也不会静默降级为假对手。

### 手动启动

```powershell
git clone https://github.com/JucieOvo/model-mayhem.git
Set-Location model-mayhem
Copy-Item .env.example .env
pnpm install --frozen-lockfile
pnpm start
```

编辑 `.env`，按需填写：

```text
DEEPSEEK_API_KEY=你的密钥
```

不要把 `.env`、API Key、座位令牌或真实日志提交到 Git。

## 首次进入游戏

首次运行后建议按以下顺序体验：

1. 阅读首页的首次运行说明。
2. 完成中国财团或西方财团选择。
3. 进入教程页，跟随规则教程完成一场引导对局。
4. 在收藏页查看已解锁卡牌。
5. 在牌组页选择一套合法预组，或自行调整蓝图和招牌行动。
6. 选择陪练、标准或对抗难度开始对局。
7. 在对局结束后查看研究地图和科技线。
8. 使用对局获得的研究数据解锁节点，扩充下一场对局的构筑范围。

更完整的人类规则说明见：

- `docs/guides/2026-09-13-对战规则与胜利机制教程.md`
- `docs/guides/winning-strategies.md`

## 开发模式

安装依赖：

```powershell
pnpm install
```

同时启动服务端和 Vite 开发客户端：

```powershell
pnpm dev
```

也可以分开启动：

```powershell
pnpm dev:server
pnpm dev:web
```

开发模式默认地址：

| 服务 | 默认地址 |
|---|---|
| Web | `http://127.0.0.1:5173` |
| API、SSE 与 MCP | `http://127.0.0.1:3210` |

本地生产运行：

```powershell
pnpm release:run
```

## 常用配置

配置从进程环境变量或本地 `.env` 读取。完整示例见 `.env.example`。

### 服务

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 服务监听地址 |
| `PORT` | `3210` | 服务监听端口 |
| `MODELMAYHEM_DATA_DIR` | `./data` | 玩家数据、日志和 Agent 运行时根目录 |
| `MODELMAYHEM_PROFILE_ID` | `local` | 本地档案标识 |
| `MODELMAYHEM_CONTROL_TOKEN` | 空 | 可选控制令牌，至少 32 个字符 |

### Agent

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 空 | 内置 Pi 对战 Agent 的模型密钥 |
| `PI_AGENT_PROMPT_TIMEOUT_MS` | `180000` | 单次 Agent 推理超时，范围 1000 到 600000 |
| `PI_AGENT_TOOL_TIMEOUT_MS` | `15000` | 单次对战工具超时，范围 100 到 120000 |
| `MODELMAYHEM_AGENT_RUNTIME_DIR` | `./data/agent-runtime` | Agent 隔离运行目录 |

### 系统内容更新

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MODELMAYHEM_UPDATE_REPOSITORY` | 公开仓库地址 | Git 更新源 |
| `MODELMAYHEM_UPDATE_CHANNEL` | `stable` | `stable`、`preview` 或 `custom` |
| `MODELMAYHEM_CONTENT_BRANCH` | `content/stable` | 卡面、侃词和多媒体来源 |
| `MODELMAYHEM_BALANCE_BRANCH` | `balance/stable` | 数值、牌组和研究来源 |
| `MODELMAYHEM_UPDATE_CHECK_ON_START` | `true` | 启动时检查更新 |
| `MODELMAYHEM_UPDATE_AUTO_INSTALL` | `false` | 是否自动安装已经验证的更新 |
| `MODELMAYHEM_GIT_EXECUTABLE` | `git` | Git 可执行文件名称或路径 |

### 沙盒和开发者接口

默认关闭：

```text
MODELMAYHEM_SANDBOX=false
MODELMAYHEM_DEV_API=false
MODELMAYHEM_DEV_REMOTE=false
```

启用沙盒需要同时打开前两项：

```powershell
$env:MODELMAYHEM_SANDBOX = "true"
$env:MODELMAYHEM_DEV_API = "true"
pnpm start
```

沙盒接口即使启用也只接受回环连接。只有显式设置 `MODELMAYHEM_DEV_REMOTE=true` 才允许
非回环访问。

## 玩家数据、备份与恢复

运行数据默认位于：

```text
data/
  model-mayhem.sqlite
  logs/
  agent-runtime/
  backups/
    manual/
    rollback/

  installation/
    releases/
    active.json
    rollback.json
    pending.json
```

`data/` 不会进入 Git 和公开发行包。删除该目录可以移除本地玩家数据和内置 Agent 状态。
系统更新时保留在 `data/backups/rollback/` 中的数据属于更新事务的一部分，不要手动混用。

### 手动备份

```powershell
node scripts/backup-player.mjs
```

默认输出到：

```text
data/backups/manual/
```

### 从快照恢复

恢复会覆盖当前玩家数据库。必须先停止或准备重启服务：

```powershell
node scripts/restore-player.mjs --confirm "--snapshot=<快照路径>"
pnpm start
```

脚本会先执行 SQLite 完整性检查，再把快照排队为下一次启动时的原子恢复。运行中的服务
不会直接替换活动数据库。

### 清理活动运行态

```powershell
pnpm reset:release
```

该命令会清理活动数据库、安装缓存、日志、临时目录和 Web 构建产物，但保留
`data/backups/` 中的手动备份。执行前应确认不再需要当前活动档案。

## 系统内容更新

项目把核心代码和易变内容分开管理：

| 内容 | 来源 |
|---|---|
| 核心代码与规则引擎 | `main` |
| 卡面、侃词、多媒体和问题 | `content/stable` 或 `content/next` |
| 卡牌数值、牌组、研究和技术线 | `balance/stable` 或 `balance/next` |

稳定通道默认读取：

```text
content/stable
balance/stable
```

更新器会分别暂存两个 Git 来源，在本地组合为一个完整内容包，执行真实内容加载校验，
再一次性安装。更新完成需要重启服务。

更新使用 A-B-C 单回滚点：

```text
安装 A -> 回滚点为安装前数据
安装 B -> B 成为活动版本，A 成为回滚点
安装 C -> C 成为活动版本，B 成为回滚点，旧 A 清理
```

如果检测到系统内容被本地修改，或数据库结构和迁移记录偏离官方安装记录，自动更新会停止。
玩家自行修改的社区衍生版本不会被官方更新覆盖。

## 检查、测试和发行

运行完整检查：

```powershell
pnpm check
```

执行发行前验证：

```powershell
pnpm verify:release
```

生成干净发行归档：

```powershell
pnpm package:release
```

发行归档只允许从已提交且工作区干净的 Git 版本生成。脚本会检查环境文件、运行时数据库、
日志、私钥和常见 API Key。

## 外部 Agent 与 MCP

外部 Agent 可以连接同一个对局服务，不需要启动第二套服务：

| 接口 | 地址 | 用途 |
|---|---|---|
| REST | `/api/matches/*` | 读取状态、模拟和提交语义行动 |
| SSE | `/api/matches/:matchId/events` | 玩家侧公开事件流 |
| MCP | `/mcp` | 标准 MCP 工具、资源和提示词 |

对局接口需要创建对局时签发的座位令牌：

```text
Authorization: Bearer <seat-token>
```

座位令牌不是账号体系。Agent 令牌只有 `read` 和 `play` 权限，不能读取玩家收藏、研究、
私人牌组编辑状态、回放或 SSE 事件流。

详细接入方式、工具契约和二次开发边界见 `AGENT.md`。

## 安全边界

- 规则状态只能由服务端规则引擎修改。
- 浏览器和 Agent 都不能直接写数据库或修改规则状态。
- Agent 只能提交 `availableActions` 中的完整语义行动。
- Pi 对战 Agent 不注册文件、Shell 或浏览器工具。
- Pi 对战 Agent 的会话、缓存和临时目录被限制在 `data/agent-runtime/`。
- 默认只支持 `127.0.0.1` 上的本机单人运行。
- 项目不提供公网账号体系、多用户隔离和互联网对战匹配。
- 修改 `HOST` 后，网络隔离、TLS、反向代理和访问鉴权由部署者负责。
- 控制接口可使用 `X-ModelMayhem-Control-Token` 保护，但不能替代完整网络鉴权。

完整说明见 `SECURITY.md`。

## 当前范围

当前支持：

- 本地单人对战。
- 玩家对内置 Pi Agent。
- 外部 Agent 通过 REST、SDK 或 MCP 接入。
- 牌组编组、研究科技线、教程、回放和沙盒。
- 卡面内容与数值内容分离更新。
- 本地备份、恢复、A-B-C 回滚和发行检查。

当前不支持：

- 账号注册、登录和云端档案同步。
- 公网部署安全保证。
- 玩家与玩家之间的局域网或互联网匹配。
- 多座位对局和观战系统。
- 内容包签名、远程信任链和自动差异合并。

局域网前端访问可以由用户自行配置，但服务端仍应以本机回环地址为默认安全边界。

## 维护和检查清单

发布前至少执行：

```powershell
pnpm check
pnpm verify:release
git diff --check
```

涉及更新器时还必须验证：

1. `content/stable` 和 `balance/stable` 都能独立检出。
2. 两个来源的清单标识和版本一致。
3. 组合内容可以通过完整内容加载器校验。
4. 更新安装后要求重启，并且回滚点仍然存在。
5. 玩家数据库的 schema 指纹与迁移记录一致。

涉及 Agent 时必须验证：

1. `DEEPSEEK_API_KEY` 未配置时 Agent 明确暂停。
2. Agent 只能调用已注册的对战工具。
3. Agent 不能读取对手手牌、问题答案或回放。
4. 每回合都能完成 `get_turn_context`、必要的 `simulate_action`、`perform_action` 和
   `end_turn`。
5. 工具超时、非法行动和模型错误会写入审计日志，不伪造成功。

## 常见问题

### 服务启动后浏览器无法访问

确认服务进程仍在运行，并访问 `.env` 中配置的地址和端口。默认地址是
`http://127.0.0.1:3210`。

### Agent 一直显示暂停

检查 `DEEPSEEK_API_KEY` 是否已写入进程环境或 `.env`，并确认启动服务时能够读取该配置。
重新启动服务后再次创建对局。

### 更新检查失败

确认已安装 Git，更新仓库地址可访问，并且当前系统内容没有被本地修改。数据库结构或迁移
记录不匹配时，官方自动更新会主动停止。

### 如何重置活动数据但保留手动备份

```powershell
pnpm reset:release
```

### 如何只检查环境而不启动服务

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run.ps1 -CheckOnly
```

## 许可证与贡献

项目代码使用 Apache License 2.0，完整条款见 `LICENSE`。第三方软件说明见 `NOTICE` 和
`THIRD_PARTY_LICENSES`。内容来源和权利边界见 `CONTENT_SOURCES.md`。

社区贡献通过 Pull Request 进入对应集成分支。贡献者和维护者职责见
`CONTRIBUTING.md`，详细流程见 `docs/community/contribution-model.md`。

`main` 保存框架和破坏性代码更新。`content/*` 保存易变展示内容，`balance/*` 保存数值和
研究内容。社区贡献者不能直接推送稳定分支或发行标签。
