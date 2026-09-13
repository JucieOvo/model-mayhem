---
author: JucieOvo
project: modelmayhem
updated: 2026-09-13
---

# Model Mayhem 基础框架

本仓库同时提供两层交付：

1. 通用、确定性的卡牌对战框架。
2. 《模型大战魔型》首个参考规则包与浏览器客户端。

当前实现允许替换内容、规则包、客户端与 Agent。通用内核不写死算力、资本、影响力、Benchmark 或现实组织名称。

## 目录

```text
apps/
  server/                  Hono 对局、成长、REST、SSE 与 MCP 服务
  web/                     React 参考客户端

packages/
  content-updater/          Git 系统内容检查、暂存、安装与回滚
  game-kernel/             通用确定性状态机
  model-mayhem-content/    内容结构和 YAML 内容加载
  model-mayhem-rules/      Model Mayhem 规则包
  contracts/               API 与工具共享结构
  simulator/               无界面候选行动模拟
  game-tools/              Agent 共用工具网关
  game-client/             官方 Pi 使用的直连工具客户端
  agent-sdk/               外部程序使用的 TypeScript SDK
  mcp-binding/             标准 MCP 接口绑定
  pi-agent-adapter/        隔离的 Pi 单体对战适配器
  persistence/             SQLite 与 Drizzle 持久化
  skills/                  官方 Agent Skills

content/
  manifest/                内容包版本清单
  cards/                   单卡单文件 YAML
  research/                研究节点 YAML
  decks/                   初始预组 YAML
  balance/                 系统平衡参数 YAML
  questions/               技术检定题目 YAML

vendor/
  pi-agent/                Pi 单体源码审计快照，仅存在于内部开发仓库
```

公开源码发行包会排除 `vendor/`、内部任务稿和设计草稿。运行公开源码时，Pi 组件从
`pnpm-lock.yaml` 锁定的发布包安装。

## 获取与安装

公开源码通过 Git 获取。Windows 用户安装 Node.js 22.22.0 或更高版本后，可以直接
双击根目录的 `start.cmd`。首次运行会自动完成依赖安装、配置初始化和前端构建，并在
服务就绪后打开浏览器：

```text
start.cmd
```

首次运行会根据 `.env.example` 创建被 Git 忽略的 `.env`，并询问
`DEEPSEEK_API_KEY`。直接回车可以跳过，游戏仍可启动，但对战 Agent 会明确暂停。

也可以在终端执行同一条启动流程：

```powershell
git clone https://github.com/JucieOvo/model-mayhem.git
Set-Location model-mayhem
pnpm start
```

代码更新使用 Git 拉取；卡面和侃词由内置更新器从 `content/stable` 获取，卡牌效果和
平衡数值从 `balance/stable` 获取。两个来源在本地组合后作为一个事务安装。需要生成归档时，
`pnpm package:release` 只打包已提交且工作区干净的版本。

## 开发

```powershell
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

启动服务端和参考客户端：

```powershell
pnpm dev
```

本地发行启动（先构建 Web，再由服务端统一托管）：

```powershell
Copy-Item .env.example .env
pnpm release:run
```

真实 Agent 模式需要设置：

```powershell
$env:DEEPSEEK_API_KEY = "..."
$env:PI_AGENT_PROMPT_TIMEOUT_MS = "180000"
$env:PI_AGENT_TOOL_TIMEOUT_MS = "15000"
```

没有密钥时，Agent 模式会明确报错，不会伪造行动或自动降级。
`PI_AGENT_PROMPT_TIMEOUT_MS` 可选，默认值为 180000 毫秒，即 3 分钟。
`PI_AGENT_TOOL_TIMEOUT_MS` 可选，默认值为 15000 毫秒。

内置对战 Agent 的隔离运行目录默认为 `data/agent-runtime`，可通过
`MODELMAYHEM_AGENT_RUNTIME_DIR` 修改。它不注册文件或 Shell 工具，不使用用户 Pi
配置与会话目录；删除 `data/` 即可移除全部对战 Agent 本地状态。

沙盒与开发者作弊接口默认关闭：

```powershell
$env:MODELMAYHEM_SANDBOX = "true"
$env:MODELMAYHEM_DEV_API = "true"
```

沙盒允许玩家解锁全部内容、刷研究数据、修改对局资源和直接胜利，不影响正式档案。

系统内容更新使用 Git 分支和 A-B-C 单回滚点。更新前会备份玩家数据库，系统内容只进入不可变版本目录。日志和诊断包不会输出 `DEEPSEEK_API_KEY`、Bearer 头或座位令牌。

默认稳定更新源为公开仓库的 `content/stable` 和 `balance/stable` 分支。项目基线只支持回环地址上的本机单用户
部署，不提供公网或多用户账号体系。高级用户可以自行修改 `HOST` 并从非回环地址访问，但网络
隔离、反向代理、TLS 和访问鉴权由部署者自行负责；普通档案接口不包含账号级鉴权。

安全和秘密保护边界见 `SECURITY.md`。

## 许可证与来源

项目代码使用 Apache License 2.0，完整条款见 `LICENSE`。第三方软件通知见
`NOTICE` 和 `THIRD_PARTY_LICENSES`。项目开发者贡献见 `CONTRIBUTORS.md`，游戏内容
使用的公开研究、产品资料、社区讨论和外部素材见 `CONTENT_SOURCES.md`。

社区内容、侃词、多媒体和数值平衡的贡献模型见
`docs/community/contribution-model.md`。`main` 保存框架与破坏性代码更新，
`content/stable` 与 `balance/stable` 分别保存可安全同步的卡面和数值版本，社区贡献通过
拉取请求进入维护者审核流程。

## 边界

- 规则状态只能由服务端规则引擎修改。
- Agent 只能使用合法工具提交行动。
- Pi 对战 Agent 与用户自己的 Pi Coding Agent 使用独立实例、配置、会话和工具白名单。
- 外部 Agent 使用标准 MCP 客户端连接；官方 Pi 使用 TypeScript 直连工具客户端。
- 具体内容位于 YAML，不把卡牌效果写进界面或通用规则分支。
- 玩家数据位于 `data/`，发行包和 Web 构建产物不得包含数据库、日志或环境文件。
