---
author: JucieOvo
project: modelmayhem
updated: 2026-09-13
---

# 安全说明

## API Key 与令牌

- 真实 `DEEPSEEK_API_KEY` 只从进程环境或本地 `.env` 读取。
- `.env`、数据库、日志和诊断包不得提交到 Git。
- 服务端日志会脱敏 `DEEPSEEK_API_KEY`、Bearer 头、座位令牌、密码和带凭据的 Git URL。
- 诊断接口只返回 Key 是否配置，不返回 Key 内容。

## 本地服务

默认监听 `127.0.0.1`。只有显式设置 `HOST=0.0.0.0` 时，局域网设备才能访问前端和服务。

内置对战 Agent 的工作目录、会话、缓存和临时目录统一位于 `data/agent-runtime/`。它不注册文件、Shell 或浏览器工具，也不使用用户自己的 Pi Agent 配置、会话或凭据目录。删除整个 `data/` 目录即可移除对战 Agent 的所有本地状态。

开发者沙盒接口默认关闭，并且即使启用也只接受本机回环连接。远程开启必须显式设置：

```text
MODELMAYHEM_DEV_REMOTE=true
```

## 内容更新

- 系统内容只通过 Git 分支读取，并使用 sparse checkout 限制为 `content/`。
- 内容目录禁止符号链接和非普通文件。
- 内容在安装前必须通过完整内容加载器验证。
- 系统内容或数据库结构偏离安装清单时，官方自动更新停止。

## 报告问题

安全问题应提供可复现步骤、受影响版本、相关日志片段和最小复现输入。请先移除 API Key、座位令牌和其他秘密后再提交。
