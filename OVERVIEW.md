---
author: JucieOvo
project: modelmayhem
updated: 2026-09-13
---

# Model Mayhem 代码与架构概览

本文面向需要阅读、维护或扩展代码的开发者，说明仓库的模块边界、运行链路、数据流和
扩展入口。

## 1. 项目定位

仓库交付两层能力：

```text
通用卡牌框架
    game-kernel
    game-tools
    game-client
    contracts
    persistence
    content-updater
    simulator

Model Mayhem 参考实现
    model-mayhem-content
    model-mayhem-rules
    apps/server
    apps/web
    content/
    packages/pi-agent-adapter
```

通用模块不依赖具体的算力、资本、影响力、Benchmark 或现实组织名称。Model Mayhem
参考规则包负责把这些概念映射到内容、命令、效果和视图。

## 2. 顶层目录

```text
apps/
  server/                  Hono 服务、REST、SSE、MCP、对局调度
  web/                     React 参考客户端

packages/
  agent-sdk/               外部 TypeScript Agent SDK
  content-updater/         Git 内容更新、组合、安装和回滚
  contracts/               HTTP、发布、沙盒和教程协议
  game-client/             HTTP 与直连工具客户端
  game-kernel/             通用确定性状态机
  game-tools/              Agent 工具注册、权限和执行网关
  mcp-binding/             标准 MCP 工具、资源和提示词绑定
  model-mayhem-content/    YAML Schema、加载和构筑校验
  model-mayhem-rules/      Model Mayhem 命令、效果和回合规则
  persistence/             SQLite、Drizzle、快照和恢复
  pi-agent-adapter/        隔离的单体 Pi 对战 Agent
  pi-package/              Pi 运行时的兼容入口
  simulator/               无界面候选行动模拟
  skills/                  官方 Agent Skills

content/
  manifest/                内容清单
  cards/                   卡牌 YAML
  decks/                   预组
  doctrines/               方针
  eras/                    时代与时间推进
  research/                研究节点
  balance/                 平衡参数
  questions/               技术检定题
  presentation/            展示层内容

scripts/
  run.ps1                  一键启动与首次运行
  backup-player.mjs        玩家数据库备份
  restore-player.mjs       玩家数据库恢复
  reset-release.mjs        重置活动运行态
  verify-release.mjs       发行清洁检查
  package-release.mjs      生成发行归档
  audit-game-system.mjs    游戏系统和内容审计
```

## 3. 包职责

| 包 | 主要职责 | 不应承担 |
|---|---|---|
| `game-kernel` | 确定性运行时、快照、命令派发和随机状态 | 具体卡牌规则 |
| `contracts` | 跨包 API、发布和沙盒结构 | 业务结算 |
| `model-mayhem-content` | 内容 Schema、加载、引用和构筑校验 | HTTP 和 UI |
| `model-mayhem-rules` | 命令、效果、状态、合法行动和视图 | 数据库和网络 |
| `simulator` | 在真实快照副本上模拟行动 | 修改正式对局 |
| `game-tools` | 工具定义、权限和参数校验 | 规则实现 |
| `game-client` | HTTP 与直连工具调用 | 规则复制 |
| `agent-sdk` | 外部 Agent 的最小接入契约 | 内置 Agent 策略 |
| `mcp-binding` | MCP 协议适配 | 第二套游戏服务 |
| `pi-agent-adapter` | Pi 模型、工具预算、提示词和会话隔离 | 玩家成长和牌组编辑 |
| `persistence` | SQLite 表、仓储、快照和恢复 | 规则结算 |
| `content-updater` | 双来源暂存、组合、安装和回滚 | 任意代码更新 |
| `skills` | 版本化 Markdown 指导 | 权限和规则执行 |
| `apps/server` | 组合全部模块并提供协议入口 | 规则细节复制 |
| `apps/web` | 参考玩家界面 | 规则状态写入 |

## 4. 启动链路

服务启动入口是 `apps/server/src/index.ts`：

```text
读取 .env 和进程环境
    -> 加载 ServerConfig
    -> 恢复中断的更新事务
    -> 应用待恢复数据库快照
    -> 打开 SQLite
    -> 创建仓储与本地日志
    -> 创建 ContentUpdater
    -> 确认首次安装记录
    -> 检查或安装系统内容更新
    -> 加载并校验内容包
    -> 创建 MatchService 和 ToolGateway
    -> 创建 Pi Agent Runner
    -> 启动 Hono HTTP 服务
```

服务启动不会请求大模型。只有对局轮到 Agent，且配置了 `DEEPSEEK_API_KEY` 时，才会创建
真实模型请求。

## 5. 运行链路

### 5.1 玩家请求

```text
浏览器
    -> REST /api/matches/*
    -> 座位令牌解析
    -> ToolGateway
    -> ServerToolBackend
    -> MatchService
    -> GameRuntime
    -> Model Mayhem 规则定义
    -> SQLite 快照和事件
    -> 返回视图
```

浏览器不直接操作规则状态。刷新页面只会重新读取服务端状态。

### 5.2 外部 Agent

```text
外部 Agent
    -> REST 或 MCP
    -> Bearer 座位令牌
    -> ToolGateway
    -> 同一个 ServerToolBackend
    -> 同一个 MatchService
```

### 5.3 内置 Pi Agent

```text
MatchService 检测到 Agent 回合
    -> PiBattleAgentRunner
    -> DirectBattleToolClient
    -> ToolGateway
    -> ServerToolBackend
    -> MatchService
```

内置 Pi 不经过 HTTP 和 MCP。这样至少保留一个服务端、一个工具网关和多个协议客户端，
避免为内置 Agent 再引入一层 MCP 客户端。

### 5.4 SSE 和回放

```text
规则事件
    -> MatchService 事件过滤器
    -> 持久化 match_events
    -> 玩家 SSE
    -> 玩家回放

Agent 事件
    -> 公开事件可见
    -> 私有抽牌和题目事件隔离
```

SSE 和回放接口要求 `replay` 权限。Agent 令牌只有 `read` 和 `play`，不能访问这些入口。

## 6. 对局服务

`apps/server/src/match-service.ts` 是运行时协调中心，负责：

- 创建对局和座位。
- 签发和索引座位令牌。
- 根据档案财团生成玩家和 Agent 的合法牌组。
- 生成合法行动。
- 提交、模拟和幂等缓存命令。
- 持久化事件和快照。
- 恢复持久化对局。
- 运行 Pi Agent 回合。
- 结算技术检定超时。
- 过滤私有事件。
- 在终局发放研究数据并释放 Agent 会话。

`apps/server/src/tool-backend.ts` 把工具网关连接到真实服务：

- 读取公开和私有视图。
- 读取完整回合上下文。
- 生成带最终费用和预览的语义行动。
- 校验并保存牌组。
- 读取研究地图和回放。

## 7. 工具网关与协议

`packages/game-tools/src/registry.ts` 保存唯一工具定义：

```text
get_turn_context
get_match_state
get_private_state
inspect_card
inspect_rules
simulate_action
perform_action
wait_for_turn
get_research_map
update_deck
get_replay
```

权限模型：

| 权限 | 玩家 | Agent |
|---|---:|---:|
| `read` | 是 | 是 |
| `play` | 是 | 是 |
| `progress` | 是 | 否 |
| `replay` | 是 | 否 |

工具上下文由服务端令牌解析生成。工具参数不能指定任意座位、档案、对局或权限。

## 8. 内容系统

### 8.1 内容包

`packages/model-mayhem-content/` 负责：

- 读取 `content/manifest/`。
- 加载卡牌、行动、世界事件、牌组、方针、时代、研究和题目。
- 校验 ID 唯一性和引用完整性。
- 校验预算、构筑、阵营和开放度规则。
- 把 YAML 转换为规则引擎使用的 `ContentPack`。

内容类型：

| 类型 | 作用 |
|---|---|
| 组织 | 公司、平台、基础设施和长期据点 |
| 资产 | 模型、技术和论文 |
| 行动 | 一次性操作牌 |
| 世界事件 | 双方共同承受的环境变化 |

### 8.2 内容与代码边界

- 卡牌效果使用结构化效果，不执行内容中的 JavaScript 或 Shell。
- 规则代码不写具体卡牌名称分支。
- 现实事实、社区认知、梗和虚构内容使用不同事实等级。
- 每张卡一个文件，便于审查、差异比较和内容更新。
- 内容变更不得携带程序代码、数据库迁移或发行脚本。

## 9. 规则与状态机

### 9.1 `game-kernel`

通用内核负责：

- 创建和恢复 `GameRuntime`。
- 保存稳定快照。
- 接收带 `commandId`、座位和命令正文的派发请求。
- 提供确定性随机数状态。
- 返回事件、状态和规则违规。

内核不知道 Model Mayhem 的资源名称，也不依赖 HTTP、SQLite 或 UI。

### 9.2 `model-mayhem-rules`

参考规则包负责：

- 定义对局状态 `MatchState`。
- 定义 `ModelMayhemCommand`。
- 生成合法行动 `LegalAction`。
- 覆盖部署、抽牌、弃牌、行动、Benchmark、技术检定和终局。
- 计算费用、能力、状态修正和影响力。
- 生成座位视图 `ModelMayhemView`。
- 维护研究和时代推进使用的规则辅助数据。

规则模块不直接访问数据库和网络。

### 9.3 模拟器

`packages/simulator/` 从真实快照恢复一个独立运行时，在副本上执行命令。正式状态不会被
修改。模拟结果与正式结算共享同一规则定义和随机状态边界。

## 10. 持久化

`packages/persistence/` 使用 SQLite、better-sqlite3 和 Drizzle。

主要表：

| 表 | 内容 |
|---|---|
| `profiles` | 档案、财团、研究数据、完成局数和当前时代 |
| `research_progress` | 已解锁研究节点 |
| `collection` | 已解锁卡牌和行动 |
| `decks` | 玩家牌组和招牌行动 |
| `matches` | 对局元数据、难度和规则快照 |
| `match_events` | 可审计事件序列 |
| `agent_runs` | Agent 工具调用、结果、延迟和错误 |
| `content_versions` | 已加载内容版本 |
| `developer_operations` | 沙盒操作审计 |
| `tutorial_progress` | 教程步骤和关闭状态 |

数据库使用版本化迁移。内容更新前会比较数据库 schema 指纹和最后迁移记录，偏差时拒绝
官方自动更新。

玩家快照使用 better-sqlite3 的真实 backup API，恢复前执行 SQLite 完整性检查。运行中
恢复会先写 `.pending-restore`，下一次启动在打开数据库前原子替换主文件和 WAL/SHM。

## 11. 系统内容更新

`packages/content-updater/` 采用双来源模型：

```text
content branch
    presentation/
    thumbnails/
    questions/

balance branch
    cards/
    balance/
    decks/
    research/
    eras/
    doctrines/
```

流程：

```text
checkRemoteHead
    -> shallow fetch 指定提交
    -> sparse checkout 受管路径
    -> 校验来源清单和路径哈希
    -> 组合内容目录
    -> 完整内容校验
    -> 写 pending
    -> 备份玩家数据库
    -> 原子切换活动内容指针
    -> 重启服务生效
```

回滚策略：

```text
活动版本 B
回滚点 A: 内容目录 + 玩家数据库快照

安装 C
    -> C 成为活动版本
    -> B 成为新回滚点
    -> 清理旧 A
```

更新器会拒绝：

- 卡面和数值来源清单 ID 不一致。
- 来源版本低于本地版本。
- 组合内容校验失败。
- 暂存目录哈希变化。
- 系统内容被本地修改。
- 数据库 schema 或迁移记录偏离安装记录。

## 12. HTTP、SSE 与 MCP

`apps/server/src/app.ts` 同时挂载：

### 公开接口

```text
GET /api/health
GET /api/rules
GET /api/content
GET /api/cards/:cardId
GET /api/questions/:questionId
GET /api/profile
GET /api/research
GET /api/decks
GET /api/tutorial
```

### 对局接口

```text
POST /api/matches
GET  /api/matches/:matchId
GET  /api/matches/:matchId/private
GET  /api/matches/:matchId/legal-actions
GET  /api/matches/:matchId/turn-context
POST /api/matches/:matchId/simulate
POST /api/matches/:matchId/commands
GET  /api/matches/:matchId/wait
GET  /api/matches/:matchId/replay
GET  /api/matches/:matchId/events
```

### 控制接口

```text
GET  /api/update/status
POST /api/update/check
POST /api/update/install
POST /api/update/rollback
GET  /api/diagnostics
GET  /api/diagnostics/export
POST /api/matches/:matchId/resume
```

### MCP

```text
ALL /mcp
```

MCP 绑定在 `packages/mcp-binding/` 中，只把工具网关映射为 MCP 工具、资源和提示词。

## 13. 玩家客户端

`apps/web/` 使用 React 19、React Router、Zustand、Tailwind CSS 和 Radix Dialog。

页面：

```text
/
  /deck
  /research
  /collection
  /credits
  /tutorial
  /sandbox
  /settings
  /match/:matchId
  /replay/:matchId
```

客户端职责：

- 读取档案、收藏、研究和牌组。
- 创建对局并保存座位令牌。
- 渲染公开和玩家私有状态。
- 提交合法行动。
- 显示抽牌、弃牌、结算、教程和回放。
- 不执行规则计算、不修改数据库。

## 14. Agent 与 Skills

官方 Skills：

| Skill | 用途 |
|---|---|
| `modelmayhem-play` | 执行合法对局回合 |
| `modelmayhem-deckbuilding` | 玩家侧或独立牌组 Agent 构筑 |
| `modelmayhem-replay-review` | 基于公开事件复盘 |
| `modelmayhem-content-author` | 创建和校验 YAML 内容 |
| `modelmayhem-agent-builder` | 构建外部对战 Agent |

`packages/pi-agent-adapter/` 使用固定版本的 Pi Agent Core 和 Pi AI，注册：

```text
get_turn_context
simulate_action
perform_action
```

适配器负责：

- 读取两种官方规则参考文档。
- 注入当前座位、财团和完整回合上下文。
- 按难度设置工具预算和规划深度。
- 禁止查卡穷举、重复行动和调度阶段模拟。
- 强制 Agent 提交结束回合。
- 超时后中止模型请求。
- 将工具和运行审计写入数据库。
- 对局结束后清理会话目录。

Agent 可写目录由 `PiBattleRuntime` 验证，必须位于 `MODELMAYHEM_DATA_DIR` 内。

## 15. 研究与科技线

研究地图由 `content/research/`、`content/eras/`、`content/decks/` 和
`content/doctrines/` 共同定义。

运行链路：

```text
玩家完成对局
    -> MatchService 发放研究数据
    -> 玩家解锁研究节点
    -> 节点授予固定卡牌
    -> 满足时代完成条件
    -> 玩家推进时代
    -> 后续研究节点和内容解锁
```

研究节点包含：

- 分支。
- 深度。
- 前置节点和前置模式。
- 成本。
- 固定卡牌奖励。
- 所属时代。
- 完成类别。
- 谱系标识。

## 16. 二次开发位置

| 目标 | 修改位置 |
|---|---|
| 新增卡牌或内容 | `content/` |
| 新增效果类型 | `packages/model-mayhem-rules/src/effects.ts` 和内容 Schema |
| 修改合法行动 | `packages/model-mayhem-rules/src/legal-actions.ts` |
| 修改回合和终局 | `packages/model-mayhem-rules/src/turn.ts`、`engine.ts` |
| 新增工具 | `packages/game-tools/src/registry.ts` 和真实后端 |
| 修改 HTTP 接口 | `apps/server/src/app.ts` |
| 修改 Agent 提示词 | `packages/skills/` 和 `packages/pi-agent-adapter/` |
| 修改历史或回放 | `persistence`、`match-service` 和 Web 回放页 |
| 替换内容更新源 | `packages/content-updater/` |
| 替换玩家客户端 | `apps/web/` 或新的 REST 客户端 |

## 17. 测试和检查

测试使用 Vitest，测试文件与实现包共置。

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm verify:release
```

当前检查覆盖：

- 通用状态机。
- 内容 Schema、加载和构筑。
- 规则命令、效果、Benchmark 和回合。
- 模拟器。
- 工具注册和权限。
- MCP 绑定。
- HTTP 服务和 Agent 调度。
- Pi Agent 运行和超时。
- SQLite 仓储和迁移。
- Git 内容来源、组合和回滚。
- 日志脱敏和发行清洁。

这里列出的检查名称和范围会随代码变化。执行时以 `package.json` 和各包测试文件为准，
不要把历史通过记录当作当前版本证据。

## 18. 已知边界

- 标准对局只支持两个座位。
- 默认只支持本机回环地址和本地单用户档案。
- 不提供账号、登录、云同步和公网安全保证。
- 前端刷新不会中断服务端 Agent，但浏览器内存中的未持久化显示状态可能重建。
- 座位令牌只存在于当前服务进程；重启后需要恢复接口重新签发。
- 内容更新只处理系统内容，不升级程序代码或数据库迁移。
- 最小和最大引擎版本范围、清单签名和发行差异报告尚未接入。
- Agent 只负责对局，不负责牌组编组、科技推进和回放分析。

## 19. 关键不变量

修改代码时应保持：

1. 服务端是唯一规则写入口。
2. 内容不携带可执行代码。
3. 随机数和规则结算可复现。
4. Agent 只能看到授权信息。
5. 私有抽牌和题目信息不进入对手事件流。
6. 更新只切换系统内容，不破坏玩家进度。
7. 更新失败时保留内容和玩家数据回滚点。
8. 任何协议适配器都复用同一工具网关和规则核心。
