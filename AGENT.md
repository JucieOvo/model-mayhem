---
author: JucieOvo
project: modelmayhem
updated: 2026-09-13
---

# Model Mayhem Agent 操作与开发指南

本文面向三类读者：

1. 在仓库中工作的代码 Agent。
2. 通过 MCP、REST 或 TypeScript SDK 接入的外部对战 Agent。
3. 替换规则、客户端、内容或持久化实现的二次开发者。

服务端是规则状态的唯一写入口。任何 Agent 都不能直接修改数据库、运行状态或规则内存。
Agent 的职责是读取真实上下文、选择合法行动、提交完整语义对象并核对结果。

## 1. 权威顺序

发生冲突时，按以下顺序判断：

1. 服务端真实状态、合法行动、行动预览和结算结果。
2. 当前内容包中的结构化 YAML 和运行时 `rulesSummary`。
3. `modelmayhem-play` Skill 及其两份参考文档。
4. 本文件、`OVERVIEW.md` 和规则教程。
5. 其他说明、评论和历史记录。

对局中的最高权威是当前服务端返回的 `availableActions`。不要根据卡牌名称、旧截图、
旧日志或自然语言猜测效果。

## 2. 推荐阅读顺序

代码 Agent 开始修改前按需读取：

```text
README.md
AGENT.md
OVERVIEW.md
SECURITY.md
CONTRIBUTING.md
package.json
pnpm-workspace.yaml
apps/server/src/index.ts
apps/server/src/app.ts
packages/model-mayhem-rules/src/
content/README.md
```

对战 Agent 固定读取：

```text
packages/skills/skills/modelmayhem-play/SKILL.md
packages/skills/skills/modelmayhem-play/references/combat-rules.md
packages/skills/skills/modelmayhem-play/references/battle-guide.md
```

## 3. 基本操作原则

### 必须执行

- 修改前先检查真实文件、Git 状态、现有测试和当前配置。
- 修改后运行与改动风险相称的真实检查。
- 更新内容时验证两个 Git 来源、组合内容和数据库兼容性。
- Agent 接入时验证座位令牌、权限、超时和非法行动处理。
- 把失败、超时、拒绝和未验证状态如实报告给调用方。

### 禁止执行

- 不把模型推理结果直接当作规则结算结果。
- 不绕过工具网关直接写数据库或规则状态。
- 不读取或推断对手隐藏手牌、牌序、问题答案和回放。
- 不自行生成对局内部 `actionId` 或 `commandId`。
- 不在对战 Agent 中注册文件、Shell、浏览器或用户目录工具。
- 不使用 Mock、Stub、假数据或伪成功结果代替真实实现。
- 不执行 `git clean -fd`。
- 不提交 `.env`、API Key、座位令牌、数据库、日志或诊断包。

## 4. 下载、安装与启动

### Windows 一键启动

```text
start.cmd
```

脚本会创建 `.env`、安装锁定依赖、构建 Web 并启动服务。首次运行可以在提示时输入
`DEEPSEEK_API_KEY`，也可以直接回车跳过。

### 手动安装

```powershell
git clone https://github.com/JucieOvo/model-mayhem.git
Set-Location model-mayhem
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm start
```

### 只检查环境

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run.ps1 -CheckOnly
```

### 不启动浏览器

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run.ps1 -NoBrowser
```

### 只准备但不启动服务

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run.ps1 -NoStart
```

### 开发模式

```powershell
pnpm dev
```

或者分别启动：

```powershell
pnpm dev:server
pnpm dev:web
```

默认服务地址是 `http://127.0.0.1:3210`。开发客户端默认监听
`http://127.0.0.1:5173`，并把 `/api` 和 `/mcp` 代理到服务端。

## 5. 检查与发行门禁

所有改动后至少执行：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

一次性完整检查：

```powershell
pnpm check
```

发行前检查：

```powershell
pnpm verify:release
git diff --check
```

发行归档：

```powershell
pnpm package:release
```

`package:release` 只在工作区干净时运行，并使用 `git archive` 和 `.gitattributes` 排除
内部任务稿、运行时目录、数据库、日志、环境和第三方源码审计快照。

## 6. 运行配置

### Agent 配置

| 变量 | 默认值 | 约束 |
|---|---:|---|
| `DEEPSEEK_API_KEY` | 空 | 未配置时 Agent 回合暂停 |
| `PI_AGENT_PROMPT_TIMEOUT_MS` | `180000` | 1000 到 600000 |
| `PI_AGENT_TOOL_TIMEOUT_MS` | `15000` | 100 到 120000 |
| `MODELMAYHEM_AGENT_RUNTIME_DIR` | `data/agent-runtime` | 必须位于 `MODELMAYHEM_DATA_DIR` 内 |

内置 Pi Agent 的模型标识为 `pi-deepseek-flash`，请求使用 DeepSeek OpenAI Responses
接口和 `deepseek-flash` 模型名。推理等级为 `high`。模型目录变化时以
`packages/pi-agent-adapter/src/index.ts` 和当前依赖为准。

### 控制配置

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 默认仅本机访问 |
| `PORT` | `3210` | 服务端口 |
| `MODELMAYHEM_CONTROL_TOKEN` | 空 | 保护更新、诊断、恢复等控制接口，至少 32 字符 |
| `MODELMAYHEM_SANDBOX` | `false` | 沙盒开关 |
| `MODELMAYHEM_DEV_API` | `false` | 开发者接口开关 |
| `MODELMAYHEM_DEV_REMOTE` | `false` | 是否允许远程开发者接口 |

启用控制令牌后，控制请求使用：

```text
X-ModelMayhem-Control-Token: <token>
```

## 7. 服务端权威与隐藏信息

### 服务端负责

- 创建对局、座位和座位令牌。
- 洗牌、抽牌、随机数、合法行动生成。
- 规则结算、事件持久化、回放过滤。
- 行动幂等、技术检定超时结算。
- Agent 调度、审计记录和错误状态。
- 玩家数据快照、恢复和内容更新。

### 浏览器负责

- 展示公开状态和玩家自己的私有状态。
- 把语义行动提交给服务端。
- 展示事件、抽牌、弃牌、结算和教程提示。

前端刷新不会推进或回滚规则状态。前端丢失的本地显示可以从服务端状态和事件重新构建。

### 座位权限

| 座位 | 权限 |
|---|---|
| 玩家座位 | `read`、`play`、`progress`、`replay` |
| Agent 座位 | `read`、`play` |

Agent 看不到：

- 对手蓝图手牌和行动手牌。
- 未来抽牌顺序。
- 技术检定正确答案。
- 玩家收藏和研究地图。
- 当前出战牌组之外的私人编辑状态。
- 回放和 SSE 事件流。

Agent 可以看到：

- 双方公开场面和资源。
- 自己的手牌、资源、蓝图组成和合法行动。
- 当前世界事件、公开状态、Benchmark 结果和公开日志。

## 8. REST 接入

### 创建对局

```http
POST /api/matches
Content-Type: application/json

{
  "deckId": "<deck-id>",
  "difficulty": "standard"
}
```

可选字段：

```json
{
  "seed": 123456,
  "tutorial": false
}
```

响应包含：

```json
{
  "matchId": "<match-id>",
  "playerSeatId": "player",
  "seatToken": "<seat-token>",
  "view": {}
}
```

`seatToken` 只在对局服务内存中有效。服务重启后，需要通过受控制保护的
`POST /api/matches/:matchId/resume` 重新签发玩家令牌。

### 对局接口

除健康检查和公开内容接口外，对局接口需要座位令牌：

```http
Authorization: Bearer <seat-token>
```

主要接口：

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/matches/:matchId` | 公开视图和 Agent 状态 |
| `GET` | `/api/matches/:matchId/private` | 当前座位私有状态 |
| `GET` | `/api/matches/:matchId/legal-actions` | 当前合法行动 |
| `GET` | `/api/matches/:matchId/turn-context` | 完整回合上下文 |
| `POST` | `/api/matches/:matchId/simulate` | 在快照上模拟语义行动 |
| `POST` | `/api/matches/:matchId/commands` | 提交语义行动 |
| `GET` | `/api/matches/:matchId/wait` | 等待主动回合 |
| `GET` | `/api/matches/:matchId/replay` | 读取当前权限允许的回放 |
| `GET` | `/api/matches/:matchId/events` | SSE 事件流，需要 `replay` 权限 |

### 行动提交格式

推荐从 `availableActions` 中完整取出一个 `action` 对象：

```json
{
  "commandId": "由客户端生成的唯一请求 ID",
  "command": {
    "kind": "<action-kind>"
  }
}
```

不要自行构造内部 `actionId`。语义行动由服务端校验、解释和结算。

## 9. 统一工具网关

所有协议共享以下工具。工具名称和输入结构以
`packages/game-tools/src/registry.ts` 为准。

| 工具 | 权限 | 模式 | 用途 |
|---|---|---|---|
| `get_turn_context` | `read` | 并行 | 一次读取状态、规则、卡牌摘要和可用行动 |
| `get_match_state` | `read` | 并行 | 读取当前座位公开视图 |
| `get_private_state` | `read` | 并行 | 读取自己的私有状态 |
| `inspect_card` | `read` | 并行 | 查询公开卡牌结构 |
| `inspect_rules` | `read` | 并行 | 查询规则和平衡摘要 |
| `simulate_action` | `read` | 并行 | 在真实快照副本上模拟候选行动 |
| `perform_action` | `play` | 顺序 | 提交一个完整语义行动 |
| `wait_for_turn` | `read` | 并行 | 等待当前座位获得行动权 |
| `get_research_map` | `progress` | 并行 | 读取研究地图 |
| `update_deck` | `progress` | 顺序 | 保存合法牌组 |
| `get_replay` | `replay` | 并行 | 读取授权回放 |

Agent 工具的典型调用链：

```text
get_turn_context
    -> 读取 availableActions
    -> 选择完整 action
    -> simulate_action（可选，只比较 1 至 3 条路线）
    -> perform_action
    -> 重新读取 get_turn_context
    -> perform_action(end_turn)
```

### 行动后检查

每次提交后至少确认：

1. `accepted` 是否为真。
2. 是否存在 `violation.code` 和 `violation.message`。
3. 资源、场面、行动池和影响力是否符合预览。
4. 当前是否仍是自己的回合。
5. 调度阶段是否已设置 `mulliganReady`。
6. 主要阶段是否最终提交了 `end_turn`。

如果工具返回错误、超时或拒绝，不要假设行动成功，也不要编造替代结果。

## 10. MCP 接入

MCP 端点是：

```text
http://127.0.0.1:3210/mcp
```

每个请求都必须携带当前座位的 Bearer 令牌。服务端从请求头解析令牌，不从工具参数中
读取座位或权限。

可用资源：

```text
modelmayhem://rules/current
modelmayhem://rules/combat
modelmayhem://guides/battle
```

可用提示词：

```text
learn_rules
take_turn
```

MCP 绑定层只映射统一工具网关，不复制规则、不保存第二份对局状态。

## 11. TypeScript Agent SDK

安装工作区依赖后，可使用：

```ts
import {
  createAgentBattleClient,
  runAgentDecision,
} from "@modelmayhem/agent-sdk";
```

典型流程：

1. 调用 `POST /api/matches` 创建对局并取得 `matchId` 和 `seatToken`。
2. 使用 `createAgentBattleClient` 创建 HTTP 工具客户端。
3. 用 `getTurnContext` 读取完整上下文。
4. 使用合法行动构建决策。
5. 使用 `runAgentDecision` 或 `submitAction` 提交。
6. 每回合结束前提交 `end_turn`。

内嵌 Pi 使用 `DirectBattleToolClient`，直接连接服务端工具网关，不经过 HTTP 和 MCP。
外部 Agent 使用 `HttpBattleToolClient` 或标准 MCP 客户端。两条路径共享相同工具名和
输入契约。

## 12. 内置 Pi Agent 行为

内置 Pi Agent 具有以下隔离和预算：

| 难度 | 最大查询和模拟工具预算 | 规划深度 |
|---|---:|---:|
| 陪练 | 8 | 1 |
| 标准 | 14 | 2 |
| 对抗 | 20 | 3 |

预算不包含必要的 `perform_action`。Agent 仍必须在预算内完成合法行动和结束回合。

Pi Agent 的行为边界：

- 只注册 `get_turn_context`、`simulate_action` 和 `perform_action`。
- 不注册文件、Shell、浏览器、网络下载或用户配置工具。
- 不使用用户自己的 Pi Coding Agent 会话、缓存或配置。
- 所有可写路径位于 `data/agent-runtime/`。
- 不编辑牌组、不推进研究、不解锁卡牌、不分析回放。
- Agent 牌组由服务端按对立财团随机生成，并满足同一构筑规则。
- 难度不提供隐藏资源、额外费用或额外得分。
- 错误、超时和非法行动会进入 `agent_runs` 审计表。

## 13. 维护、更新与恢复

### 系统内容检查

状态：

```http
GET /api/update/status
```

检查：

```http
POST /api/update/check
```

安装：

```http
POST /api/update/install
```

回滚：

```http
POST /api/update/rollback
```

后三个接口在配置控制令牌后需要 `X-ModelMayhem-Control-Token`。

更新器执行：

1. 分别读取 `content` 和 `balance` 分支。
2. 暂存两个来源的受管路径。
3. 验证来源清单、路径哈希和组合目录树哈希。
4. 使用当前内容加载器验证完整内容包。
5. 备份玩家数据库。
6. 一次性切换活动内容指针。
7. 在重启后加载新内容。

### 玩家数据备份

```powershell
node scripts/backup-player.mjs
```

### 玩家数据恢复

```powershell
node scripts/restore-player.mjs --confirm "--snapshot=<快照路径>"
pnpm start
```

### 重置活动运行态

```powershell
pnpm reset:release
```

### 更新后检查

1. 当前活动安装记录存在。
2. `contentVersion`、`balanceVersion` 和提交哈希正确。
3. 数据库 schema 指纹和迁移记录没有偏离。
4. 回滚点仍可用。
5. 服务已重启。
6. 内容加载器和教程流程正常工作。

## 14. 二次开发入口

### 替换规则

在 `packages/model-mayhem-rules/` 中注册新的命令、效果、状态、合法行动和视图投影。
不要在服务端路由中写卡牌名称分支。

### 替换内容

在 `content/` 中添加 YAML，并遵循：

- 每张卡一个文件。
- 引用必须真实存在。
- 卡牌效果使用结构化类型。
- 现实事实、社区认知、梗和虚构内容必须使用允许的标记。
- 不把任意 JavaScript 或 Shell 放进内容包。

### 替换客户端

Web 客户端只依赖 REST、状态视图和事件。替换客户端时不得绕过服务端验证或直接修改
规则状态。

### 替换 Agent

外部 Agent 可选择：

- 标准 MCP 客户端。
- TypeScript SDK。
- 直接使用 `HttpBattleToolClient`。

接入前先实现最小合法回合，再增加规划、模拟和难度策略。

### 替换持久化

持久化实现位于 `packages/persistence/`。替换实现时必须保留：

- 对局快照和事件序列。
- 研究进度和收藏。
- 牌组和教程进度。
- Agent 运行审计。
- 内容版本记录。

### 替换更新源

更新器实现位于 `packages/content-updater/`。自定义来源必须：

- 只读取内容路径，不携带代码或迁移。
- 产生稳定提交标识和目录树哈希。
- 支持内容校验、暂存、安装和回滚。
- 在内容被本地修改时拒绝官方更新。

## 15. 社区贡献

社区贡献使用 Pull Request：

| 贡献类型 | 目标分支 |
|---|---|
| 核心代码和破坏性规则更新 | `main` |
| 侃词、卡面、缩略图和世界事件 | `content/next` |
| 数值、研究成本和预组平衡 | `balance/next` |
| 稳定内容发行 | `content/stable` |
| 稳定数值发行 | `balance/stable` |

贡献者不能直接推送 `main`、稳定分支或发行标签。项目所有者负责最终合并和发行。

提交前执行：

```powershell
pnpm check
pnpm verify:release
git diff --check
```

内容贡献必须提供来源、作者、许可证和可再分发依据。数值贡献必须提供目标 ID、当前值、
建议值、理由、样本、对照和已知风险。

## 16. 常见故障

### `DEEPSEEK_API_KEY 未配置`

Agent 不会行动。把密钥写入进程环境或本地 `.env`，重启服务后创建新对局。

### `INVALID_SEAT_TOKEN`

座位令牌无效、已过期，或当前服务进程已经重启。通过受控制保护的恢复接口重新签发令牌。

### `MATCH_PERMISSION_DENIED`

当前座位没有访问该资源的权限。Agent 座位不能读取回放、SSE、研究地图和玩家成长数据。

### 行动被拒绝

重新调用 `get_turn_context`，只从最新 `availableActions` 中选择完整 `action`。不要复用
旧行动对象或自行修改命令字段。

### 更新被拒绝

检查：

1. 系统内容是否被本地修改。
2. 数据库 schema 指纹是否与安装记录一致。
3. 迁移记录是否匹配。
4. 远端版本是否低于本地版本。
5. 两个来源的清单标识是否一致。

### 服务启动后 Agent 不运行

检查 `DEEPSEEK_API_KEY`、网络代理、`PI_AGENT_PROMPT_TIMEOUT_MS`、模型端点和
服务端日志。不要通过伪造工具结果绕过失败。

## 17. 交付前清单

- [ ] 工作区状态已检查。
- [ ] 没有提交 `.env`、数据库、日志、令牌或 API Key。
- [ ] `pnpm check` 通过。
- [ ] `pnpm verify:release` 通过。
- [ ] `git diff --check` 通过。
- [ ] 内容更新测试了检查、安装、重启和回滚。
- [ ] Agent 测试了正常回合、非法行动、超时和缺少密钥。
- [ ] 文档中的命令、变量、路径和接口与当前代码一致。
