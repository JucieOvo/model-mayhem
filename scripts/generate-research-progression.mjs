/**
 * 研究地图扩展生成器。
 *
 * 作者：JucieOvo
 *
 * 把四条研究分支扩展到每支十二层，并把 reality-v0.2 的全部生成卡分配到
 * 至少一个固定奖励节点。脚本不删除其他内容目录，只重写 content/research。
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, "..");
const contentRoot = join(projectRoot, "content");
const researchRoot = join(contentRoot, "research");
const contentRequire = createRequire(
  join(projectRoot, "packages", "model-mayhem-content", "package.json"),
);
const { parse, stringify } = contentRequire("yaml");

const branches = ["architecture", "training", "systems", "product"];
const branchLabels = {
  architecture: "架构",
  training: "训练",
  systems: "系统",
  product: "产品",
};
const stageOrder = [
  "pre_gpt3",
  "gpt3",
  "alignment",
  "multimodal_platform",
  "open_efficiency",
  "reasoning",
  "agent",
  "current",
];
const nodeCosts = [20, 30, 45, 65, 85, 110, 150, 200, 260, 330, 410, 500];
const extendedNodeNames = {
  architecture: [
    "高效注意力体系",
    "稀疏专家服务",
    "状态空间架构",
    "多模态融合",
    "Agent 架构",
    "可靠训练架构",
    "前沿组合架构",
  ],
  training: [
    "偏好数据工程",
    "过程奖励",
    "合成数据训练",
    "安全微调",
    "工具反馈训练",
    "长链推理训练",
    "前沿训练组合",
  ],
  systems: [
    "模型路由",
    "长上下文服务",
    "多租户推理",
    "本地运行",
    "异构算力",
    "高并发服务",
    "系统组合优化",
  ],
  product: [
    "模型中心",
    "企业平台",
    "实时交互产品",
    "内容生成",
    "开放生态产品",
    "Agent 平台扩展",
    "当前产品组合",
  ],
};

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function readYaml(path) {
  return parse(readFileSync(path, "utf8"));
}

function hasAny(tags, values) {
  return values.some((value) => tags.includes(value));
}

function branchScores(card) {
  const tags = card.tags ?? [];
  if (card.type === "organization") {
    return { architecture: 0, training: 0, systems: 2, product: 4 };
  }
  if (card.subtype === "technology") {
    return {
      architecture: hasAny(tags, [
        "architecture",
        "attention",
        "moe",
        "routing",
        "rope",
        "state_space",
        "transformer",
      ])
        ? 4
        : 0,
      training: hasAny(tags, ["training", "alignment", "rlhf", "grpo", "dpo", "sft", "reasoning"])
        ? 4
        : 0,
      systems: hasAny(tags, [
        "systems",
        "inference",
        "efficiency",
        "quantization",
        "distillation",
        "cache",
        "local_deployment",
      ])
        ? 4
        : 0,
      product: hasAny(tags, [
        "agent",
        "tool_use",
        "mcp",
        "memory",
        "context",
        "multimodal",
        "product",
        "api",
      ])
        ? 4
        : 0,
    };
  }
  const abilities = card.abilities ?? {};
  return {
    architecture: (abilities.coding ?? 0) * 0.8 + (abilities.reasoning ?? 0) * 0.4,
    training: (abilities.reasoning ?? 0) * 1.2,
    systems: (abilities.coding ?? 0) * 0.6 + (abilities.agent ?? 0) * 0.5,
    product: (abilities.agent ?? 0) * 1.1 + (abilities.multimodal ?? 0) * 0.9,
  };
}

function chooseBranch(card, bins) {
  const scores = branchScores(card);
  return branches
    .filter((branch) => bins[branch].length < 36)
    .sort((left, right) => {
      const scoreDifference = scores[right] - scores[left];
      if (scoreDifference !== 0) {
        return scoreDifference;
      }
      if (bins[left].length !== bins[right].length) {
        return bins[left].length - bins[right].length;
      }
      return branches.indexOf(left) - branches.indexOf(right);
    })[0];
}

function stageRank(stageId) {
  const index = stageOrder.indexOf(stageId ?? "current");
  return index < 0 ? stageOrder.length : index;
}

function stableCardSort(left, right) {
  const stageDifference = stageRank(left.stageId) - stageRank(right.stageId);
  if (stageDifference !== 0) {
    return stageDifference;
  }
  const typeDifference = (left.subtype ?? left.type).localeCompare(right.subtype ?? right.type);
  if (typeDifference !== 0) {
    return typeDifference;
  }
  return left.id.localeCompare(right.id);
}

function distribute(values, count) {
  const base = Math.floor(values.length / count);
  const remainder = values.length % count;
  const chunks = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const size = base + (index < remainder ? 1 : 0);
    chunks.push(values.slice(cursor, cursor + size));
    cursor += size;
  }
  return chunks;
}

function inferCompletionCategory(cards) {
  if (cards.some((card) => card.subtype === "model")) {
    return "model";
  }
  if (cards.some((card) => card.subtype === "paper")) {
    return "paper";
  }
  const paperSignals = [
    "attention",
    "transformer",
    "scaling",
    "moe",
    "routing",
    "rope",
    "rlhf",
    "dpo",
    "grpo",
    "distillation",
    "quantization",
    "clip",
  ];
  if (cards.some((card) => (card.tags ?? []).some((tag) => paperSignals.includes(tag)))) {
    return "paper";
  }
  return "technology";
}

function inferredStage(cards) {
  return [...cards].sort((left, right) => stageRank(left.stageId) - stageRank(right.stageId))[0]
    ?.stageId;
}

const generatedCards = walk(join(contentRoot, "cards", "reality-v0.2"))
  .filter((path) => path.endsWith(".yaml"))
  .map(readYaml)
  .sort(stableCardSort);
const existingNodes = readdirSync(researchRoot)
  .filter((file) => file.endsWith(".yaml"))
  .map((file) => readYaml(join(researchRoot, file)));
const existingByBranchDepth = new Map(
  existingNodes.map((node) => [`${node.branch}:${node.depth}`, node]),
);
const allCardIds = walk(join(contentRoot, "cards"))
  .filter((path) => path.endsWith(".yaml"))
  .map(readYaml)
  .map((card) => card.id);
const usedGeneratedIds = new Set();
const bins = Object.fromEntries(branches.map((branch) => [branch, []]));
for (const card of generatedCards) {
  const branch = chooseBranch(card, bins);
  if (!branch) {
    throw new Error(`研究奖励容量不足：${card.id}`);
  }
  bins[branch].push(card);
  usedGeneratedIds.add(card.id);
}
if (usedGeneratedIds.size !== generatedCards.length) {
  throw new Error("并非所有生成卡都进入了研究奖励池");
}

const fillerCardIds = allCardIds
  .filter((cardId) => !usedGeneratedIds.has(cardId))
  .sort()
  .slice(0, 144 - generatedCards.length);
let fillerIndex = 0;
for (const branch of branches) {
  while (bins[branch].length < 12 && fillerIndex < fillerCardIds.length) {
    const cardId = fillerCardIds[fillerIndex];
    fillerIndex += 1;
    if (cardId) {
      bins[branch].push({ id: cardId, stageId: "current", tag: ["reference"] });
    }
  }
}
if (Object.values(bins).some((cards) => cards.length < 12)) {
  throw new Error("至少一个研究分支不足十二张奖励卡");
}

for (const branch of branches) {
  const rewardGroups = distribute(bins[branch], 12);
  for (let depth = 1; depth <= 12; depth += 1) {
    const current = existingByBranchDepth.get(`${branch}:${depth}`);
    const rewards = rewardGroups[depth - 1] ?? [];
    if (rewards.length === 0) {
      throw new Error(`${branch} 深度 ${depth} 没有奖励卡`);
    }
    const id = current?.id ?? `${branch}_extended_${depth}`;
    const coreNodeId = (targetDepth) =>
      existingByBranchDepth.get(`${branch}:${targetDepth}`)?.id ??
      `${branch}_extended_${targetDepth}`;
    const prerequisiteIds =
      depth === 1
        ? []
        : depth === 6
          ? [coreNodeId(5)]
          : depth === 7
            ? [coreNodeId(5)]
            : depth === 8
              ? [coreNodeId(4)]
              : depth === 9
                ? [coreNodeId(6)]
                : depth === 10
                  ? [coreNodeId(7)]
                  : depth === 11
                    ? [coreNodeId(8)]
                    : depth === 12
                      ? [coreNodeId(9), coreNodeId(10), coreNodeId(11)]
                      : [coreNodeId(depth - 1)];
    const node = {
      id,
      branch,
      name: current?.name ?? extendedNodeNames[branch][depth - 6],
      depth,
      cost: nodeCosts[depth - 1],
      ...(prerequisiteIds.length === 1
        ? { prerequisiteId: prerequisiteIds[0] }
        : prerequisiteIds.length > 1
          ? {
              prerequisiteIds,
              prerequisiteMode: "any",
            }
          : {}),
      rewardCardIds: rewards.map((card) => card.id),
      description:
        current?.description ??
        `${branchLabels[branch]}分支第 ${depth} 层，扩展当前时代的方法、模型和产品组合。`,
      stageId: inferredStage(rewards) ?? "current",
      completionCategory: inferCompletionCategory(rewards),
      lineageIds: [...new Set(rewards.flatMap((card) => card.lineageIds ?? []))].sort(),
    };
    const fileName = current
      ? readdirSync(researchRoot).find((file) => {
          if (!file.endsWith(".yaml")) {
            return false;
          }
          return readYaml(join(researchRoot, file)).id === current.id;
        })
      : `${id}.yaml`;
    if (!fileName) {
      throw new Error(`无法确定研究节点文件名：${id}`);
    }
    writeFileSync(join(researchRoot, fileName), `${stringify(node)}\n`, "utf8");
  }
}

mkdirSync(researchRoot, { recursive: true });
console.log(
  `研究地图已生成：4 条分支，48 个节点，${generatedCards.length} 张生成卡已全部进入固定奖励。`,
);
