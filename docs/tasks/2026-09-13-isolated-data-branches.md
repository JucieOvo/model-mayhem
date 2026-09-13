---
id: isolated-data-branches
author: JucieOvo
project: modelmayhem
updated: 2026-09-13
spec_version: 0.1.2
status: complete
---

# 单仓库孤立数据分支迁移

## 目标与非目标

### 目标

把 `content/next`、`content/stable`、`balance/next`、`balance/stable` 重建为
`main` 无共同祖先的孤立分支。每个数据分支只保存自身职责下的内容文件，不再携带
`apps/`、`packages/`、`scripts/` 或其他程序本体。

迁移后需要满足：

- `content/*` 只包含卡面展示、侃词、问题、事件展示和缩略图所需数据。
- `balance/*` 只包含卡牌定义、平衡参数、牌组、研究、时代和方针数据。
- 两个来源分别保留独立清单与提交记录，更新器能够组合后一次安装。
- `next` 继续作为社区集成分支，`stable` 继续作为玩家更新器读取的稳定快照。
- `main` 保持代码本体和离线首次启动基线，不因本次迁移删除现有内容。

### 非目标

- 不修改游戏规则、卡牌效果和当前数值。
- 不新增第三套内容真源或长期版本分支。
- 不把 `next` 通过普通 merge 合入 `stable`，避免重新引入混合历史。
- 不修改普通玩家的本地数据库和运行数据。

## 当前状态

- 远端代码提交为 `a4d206d`。
- 远端四个数据分支目前均与 `main` 共享 `2378982`，每个分支约有 652 个文件。
- 远端 `main` 已实现双来源更新器、组合校验、原子安装和回滚。
- 本地原始工作树包含未提交修改；迁移在独立工作树
  `F:\modelmayhem-worktrees\isolated-data-sources` 中进行，不回退或覆盖原工作树。

## 授权范围

- 允许修改：本任务文档、社区贡献说明、README、分支基线内容。
- 允许动作：创建本地孤立分支、提交代码与文档、运行真实测试、推送、使用
  `--force-with-lease` 替换四个数据分支。
- 禁止项：不修改玩家数据库，不删除远端 `main`，不使用 `git clean -fd`，不把内部
  开发文档、运行数据或密钥带入数据分支。
- 真实指令来源：用户在本对话中确认“孤立分支，单个仓库”，随后明确回复“开始”。

## 设计决定

### 数据分支使用无共同祖先的根提交

四个数据分支分别以空树作为历史起点。`next` 与 `stable` 各保留独立提交链，发布时
把 `next` 的受管目录快照提交到 `stable`，不执行分支合并。

### 数据边界与更新器保持一致

`content/*` 保存：

```text
content/manifest/
content/presentation/
content/questions/
content/thumbnails/
```

`balance/*` 保存：

```text
content/manifest/
content/cards/
content/balance/
content/decks/
content/research/
content/eras/
content/doctrines/
```

`manifest` 是更新器分别读取来源版本的必要文件，不参与两个来源的路径覆盖冲突。

### `main` 保留离线启动基线

当前更新器以已安装内容为组合基底，只覆盖两个数据来源的受管路径。因此 `main`
继续保留一份可启动内容包，避免首次离线运行缺少内容；它不再作为稳定更新真源。

## 可执行任务

### T-001：建立四个孤立数据快照

- **目标文件**：远端四个数据分支的根提交树。
- **自然语言变更**：从 `main` 的当前内容快照提取数据分支职责内的文件，分别建立
  四个无父提交，再创建对应的 `next` 与 `stable` 分支。
- **依赖**：无。
- **验收标准**：四个分支均与 `main` 没有共同祖先；`content/*` 不含代码目录和数值
  目录；`balance/*` 不含代码目录和展示目录。
- **真实验证方式**：在完整临时克隆中使用真实 `git commit-tree` 或 orphan 工作流
  创建分支，执行 `git merge-base` 和 `git ls-tree` 核对。

### T-002：同步仓库文档

- **目标文件**：`README.md`、`CONTRIBUTING.md`、`docs/community/contribution-model.md`。
- **自然语言变更**：明确四个数据分支是单仓库孤立分支、只保存数据、通过快照推广到
  `stable`，并说明玩家更新器分别读取两个稳定来源。
- **依赖**：T-001。
- **验收标准**：文档不再暗示数据分支包含代码或通过普通 merge 进入 `stable`。
- **真实验证方式**：全文检索分支名称和“孤立”说明，人工核对目录职责与代码配置一致。

### T-003：真实组合与远端迁移验证

- **目标文件**：无新增运行时文件。
- **自然语言变更**：用真实 Git 远端对象组合两个 stable 快照，交由当前内容加载器
  校验，再推送孤立历史。
- **依赖**：T-001、T-002。
- **验收标准**：更新器测试通过；组合内容可被 `loadContentPack` 加载；远端四个分支
  文件数与预期一致。
- **真实验证方式**：运行内容更新器测试、类型检查、内容加载检查和远端 `git ls-tree`
  审计。远端替换使用 `--force-with-lease`，并保留旧提交哈希用于恢复。

## 执行与验证

### 实际变更

- 在完整临时克隆
  `F:\modelmayhem-worktrees\branch-migration` 中建立四个无父提交。
- 四个远端数据分支已使用 `--atomic` 和 `--force-with-lease` 一次替换。
- 新数据分支只包含 `.modelmayhem/branch.yaml` 和各自受管 `content/` 目录。
- 数据分支加入 `.gitattributes`，强制文本文件使用 LF，避免 Windows 稀疏检出
  按本机设置转换换行后产生虚假的更新。
- 旧分支提交已保存为远端标签，便于恢复。

实际提交：

| 分支 | 新提交 | 文件数 |
|---|---|---:|
| `content/next` | `9c951a137401ff75a58ec29d2aefe1a046348ee8` | 201 |
| `content/stable` | `5c4442f7d17952aa2389060b89be6aebd7280712` | 201 |
| `balance/next` | `1489135fc0098f6fd2bf4d2b2abb7bceb96e3253` | 260 |
| `balance/stable` | `fd2dfd01f1a755170b99a45dcab60c0931df2803` | 260 |

恢复标签：

```text
backup/pre-orphan-20260913/content-next
backup/pre-orphan-20260913/content-stable
backup/pre-orphan-20260913/balance-next
backup/pre-orphan-20260913/balance-stable
```

### 结果

| 验收项 | 状态 | 证据 |
|---|---|---|
| 四个分支与 `main` 无共同祖先 | 通过 | 两组 `git merge-base` 均以退出码 1 结束 |
| 数据目录没有越界文件 | 通过 | `git ls-tree` 白名单检查无输出 |
| 两个 stable 来源可由更新器真实稀疏检出 | 通过 | 从 GitHub 检出 `content/stable` 和 `balance/stable` 成功 |
| 组合内容可被现有加载器读取 | 通过 | 加载得到 196 张卡、2 个预组、8 个时代、48 个研究节点和 2 道题 |
| 首次检查不会产生伪更新 | 通过 | 真实远端 `checkForUpdate()` 返回 `up_to_date` |
| 更新、安装和回滚事务 | 通过 | 更新器 2 个测试文件、13 个测试全部通过 |
| 仓库检查 | 通过 | `pnpm check` 中 16 个测试文件、93 个测试全部通过，构建成功 |

### 偏差

无偏差。更新器原有双来源实现已经满足迁移需要，因此没有修改其核心逻辑。

### 未验证项

没有额外未验证项。`pnpm check` 的 Biome 输出为既有样式警告，不是本次迁移引入的失败。

## 交接

- 文档提交位于独立工作树
  `F:\modelmayhem-worktrees\isolated-data-sources`，随后快进推送到 `main`。
- 原有工作树 `F:\modelmayhem` 的未提交修改没有被读取、回退或混入本次提交。
- 数据分支后续更新直接提交对应受管目录，不重新引入 `main` 的完整代码树。

## 必要来源

- `apps/server/src/config.ts`
- `packages/content-updater/src/index.ts`
- `packages/content-updater/src/git-source.ts`
- `README.md`
- `CONTRIBUTING.md`
- `docs/community/contribution-model.md`
