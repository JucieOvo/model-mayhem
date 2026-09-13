---
author: JucieOvo
project: modelmayhem
updated: 2026-09-13
---

# 贡献说明

## 社区贡献通道

项目把核心代码和易变内容分开管理：

- `main`：当前预发布版本的核心代码、规则引擎、内容模式、更新与回滚逻辑。
- `content/next`：侃词、卡面、缩略图、世界事件和多媒体条目的社区集成分支。
- `content/stable`：稳定内容包分支。
- `balance/next`：数值平衡建议集成分支。
- `balance/stable`：稳定平衡包分支。

四个数据分支是单仓库中的孤立分支，与 `main` 没有共同祖先，只保存各自职责下的
`content/` 数据目录。提交到数据分支的 PR 不应携带 `apps/`、`packages/`、`scripts/`
或其他程序文件。

社区贡献者在个人 Fork 中创建短生命周期分支，通过 Pull Request 提交到对应的 `next`
分支。长期版本使用不可变标签或发行分支保存，不为每次内容更新创建永久工作分支。

社区贡献者不能直接推送 `main`、稳定分支或发行标签。所有社区 Pull
Request 由项目所有者 JucieOvo 审核并决定是否合入。自动检查通过只代表结构可检查，
不代表内容已经获得合并或发行许可。

玩家更新器分别读取 `content/*` 和 `balance/*` 两个真源分支，在本地组合并一次提交。
稳定通道使用 `content/stable` 与 `balance/stable`，预览通道使用 `content/next` 与
`balance/next`。`main` 只提供离线启动基线，不直接作为玩家内容更新源。

两个 `next` 分支各自包含 `preview.html`，用于在 PR 审核时查看真实数据。该文件由
分支 YAML 和缩略图生成，不应手工编辑。修改数据后运行：

```powershell
pnpm preview:community -- --root <分支工作树>
```

完整流程、自动审查、图片分析、侃词分析和平衡模拟见
`docs/community/contribution-model.md`。

## 开发检查

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## 内容与代码边界

- 系统内容放在 `content/`，玩家数据放在 `data/`。
- `data/` 不进入提交和发行包。
- 不提交 `.env`、API Key、座位令牌或真实日志。
- 卡牌效果使用结构化 YAML，不执行内容中的 JavaScript 或 Shell。
- 系统内容更新不得携带程序代码或数据库迁移。

## 许可证

项目代码使用 Apache License 2.0。提交代码即表示同意在项目许可证下分发该贡献。

原创内容、侃词和媒体素材的贡献许可证将在正式开放对应贡献通道前单独确定。第三方素材
必须在 PR 中提供来源、作者、许可证和可再分发依据。

## Agent

Agent 只能通过工具网关读取授权状态和提交合法行动。Pi 对战 Agent 与用户本机的 Pi Coding Agent 必须保持配置、会话和工具白名单隔离。
