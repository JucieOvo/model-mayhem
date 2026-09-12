---
author: JucieOvo
project: modelmayhem
updated: 2026-09-12
---

# 参考内容包

该目录是 `@modelmayhem/model-mayhem-content` 加载的版本化内容包，不属于规则代码。

## 目录职责

| 目录 | 职责 |
|---|---|
| `manifest/` | 内容包标识、内容版本和兼容规则版本 |
| `balance/` | 费用上下限、牌组规模、资源曲线和 Benchmark 参数 |
| `cards/organizations/` | 组织、平台和基础设施 |
| `cards/assets/` | 模型、技术和论文 |
| `cards/actions/` | 通用行动与招牌行动 |
| `cards/world-events/` | 世界事件 |
| `decks/` | 初始预组 |
| `doctrines/` | 初始与解锁方针 |
| `research/` | 研究节点和固定奖励 |
| `questions/` | 技术检定题库 |

现实内容包生成目录：

| 目录 | 内容 |
|---|---|
| `cards/reality-v0.2/organizations/` | 现实公司、平台和基础设施 |
| `cards/reality-v0.2/models/` | 现役和谱系模型 |
| `cards/reality-v0.2/technologies/` | 现役技术 |
| `cards/reality-v0.2/lineage-technologies/` | 谱系技术 |
| `generation/reality-v0.2.yaml` | 阶段、标签、能力和技术效果推导规则 |

重新生成现实内容：

```powershell
node scripts/generate-reality-content.mjs
node scripts/generate-research-progression.mjs
```

生成器只写入 `content/cards/reality-v0.2/`，不修改手工维护的行动、世界事件、
技术检定题；研究生成器会重写 `content/research/` 并把全部生成卡分配到固定奖励。

## 扩展约束

- 每张卡使用独立 YAML 文件。
- 每张卡最多声明一个 `thumbnail`，缩略图路径只能指向一个文件。
- `flavor` 是基础侃词，`banter` 可以追加任意数量的额外侃词。
- 效果只使用 `EffectSchema` 中的结构化类型。
- 不按卡名写规则分支，使用标签、开放度和子类型组合。
- 修改 `uniqueCardTarget` 时必须同步增加实际内容并运行内容测试。
- 新卡必须引用已存在的行动、题目、方针和奖励。
- 未核验的现实内容只能标记为 `community`、`meme` 或 `fiction`，不能标记为
  `archive`。

运行内容校验：

```powershell
pnpm --filter @modelmayhem/model-mayhem-content test
pnpm audit:game-system
```
