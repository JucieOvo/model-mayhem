---
author: JucieOvo
project: modelmayhem
updated: 2026-09-13
---

# 贡献说明

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

## Agent

Agent 只能通过工具网关读取授权状态和提交合法行动。Pi 对战 Agent 与用户本机的 Pi Coding Agent 必须保持配置、会话和工具白名单隔离。
