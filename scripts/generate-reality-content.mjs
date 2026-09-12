/**
 * 现实内容包 YAML 生成器。
 *
 * 作者：JucieOvo
 *
 * 本脚本把 reality-v0.2 的 Markdown 卡面和谱系 JSON 转换为可加载的单卡 YAML。
 * 数值由阶段、标签、能力方向和开放度推导，不按具体卡名写死费用或能力。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, "..");
const contentRoot = join(projectRoot, "content");
const realityRoot = join(projectRoot, "docs", "content", "reality-v0.2");
const contentRequire = createRequire(
  join(projectRoot, "packages", "model-mayhem-content", "package.json"),
);
const { parse, stringify } = contentRequire("yaml");
const generationConfig = parse(
  readFileSync(join(contentRoot, "generation", "reality-v0.2.yaml"), "utf8"),
);
const previewData = JSON.parse(
  readFileSync(join(realityRoot, "preview", "preview-data.json"), "utf8"),
);
const lineageData = JSON.parse(
  readFileSync(join(realityRoot, "preview", "lineage-cards.json"), "utf8"),
);

const liveSources = [
  { file: "organizations.md", type: "organization" },
  { file: "models-western.md", type: "model" },
  { file: "models-china.md", type: "model" },
  { file: "models-open-platforms.md", type: "model" },
  { file: "technologies-architecture.md", type: "technology" },
  { file: "technologies-training.md", type: "technology" },
  { file: "technologies-systems.md", type: "technology" },
  { file: "technologies-agent.md", type: "technology" },
];

const generatedRoot = join(contentRoot, "cards", "reality-v0.2");
const nodeByCardId = new Map();
for (const lineage of previewData.lineages) {
  for (const node of lineage.nodes) {
    if (node.cardId) {
      nodeByCardId.set(node.cardId, {
        nodeId: node.id,
        stageId: node.stageId,
        lineageId: lineage.id,
      });
    }
  }
}

function cleanInlineMarkdown(value) {
  return value.replace(/`([^`]+)`/g, "$1").trim();
}

function extractField(section, label) {
  const prefix = `- ${label}：`;
  const line = section.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix));
  return line ? cleanInlineMarkdown(line.slice(prefix.length)) : "";
}

function extractList(section, label) {
  const lines = section.split(/\r?\n/);
  const values = [];
  let collecting = false;
  for (const line of lines) {
    if (line.startsWith(`- ${label}：`)) {
      collecting = true;
      continue;
    }
    if (!collecting) {
      continue;
    }
    if (line.startsWith("  - ")) {
      values.push(cleanInlineMarkdown(line.slice(4)));
      continue;
    }
    if (line.startsWith("- ")) {
      break;
    }
  }
  return values;
}

function unique(values) {
  return [...new Set(values.filter((value) => value && value.length > 0))];
}

function splitTags(value) {
  return unique(
    value
      .split(/[、,，\s]+/)
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
  );
}

function parseLiveCards(source) {
  const markdown = readFileSync(join(realityRoot, source.file), "utf8");
  const headings = [...markdown.matchAll(/^### (.+)$/gm)];
  return headings.map((heading, index) => {
    const start = heading.index;
    const end = headings[index + 1]?.index ?? markdown.length;
    const section = markdown.slice(start, end);
    const id = extractField(section, "卡牌 ID");
    const description = extractField(section, "卡面描述");
    const flavor = extractField(section, "调侃");
    const skills = extractList(section, "技能");
    const sources = unique(section.match(/https?:\/\/[^\s)]+/g) ?? []);
    if (!id || !description || !flavor || skills.length === 0 || sources.length === 0) {
      throw new Error(`${source.file} 中卡牌字段不完整：${heading[1]}`);
    }
    return {
      id,
      name: heading[1].trim(),
      type: source.type,
      sourceFile: source.file,
      description,
      flavor,
      skills,
      sources,
      openLabel: extractField(section, "开放形象"),
      gameIdentity: extractField(section, "游戏身份"),
      abilityDirections: extractField(section, "能力方向"),
      compatibleOrganizations: extractField(section, "兼容组织"),
      technologyCategory: extractField(section, "技术分类"),
      gameSemantics: extractField(section, "游戏语义"),
      tags: splitTags(extractField(section, "标签")),
      combination: extractField(section, "组合关系"),
      realityAnchor: extractField(section, "现实锚点"),
      realityRole: extractField(section, "现实角色"),
    };
  });
}

function resolveVendorProfile(card) {
  for (const lineageId of card.lineageIds ?? []) {
    if (generationConfig.vendorProfiles[lineageId]) {
      return {
        id: lineageId,
        ...generationConfig.vendorProfiles[lineageId],
      };
    }
  }
  const haystack = `${card.id} ${card.name} ${card.description} ${card.skills?.join(" ") ?? ""}`;
  const matchers = [
    ["vendor.openai", /openai|gpt|codex|o[1-9]|oss/i],
    ["vendor.anthropic", /anthropic|claude/i],
    ["vendor.google_deepmind", /google|deepmind|gemini|gemma|palm|bert|t5/i],
    ["vendor.meta", /meta|llama|opt/i],
    ["vendor.microsoft", /microsoft|phi|mai|copilot|foundry/i],
    ["vendor.mistral", /mistral|mixtral|codestral|magistral|devstral|ministral/i],
    ["vendor.xai", /xai|grok/i],
    ["vendor.deepseek", /deepseek/i],
    ["vendor.qwen", /qwen|alibaba/i],
    ["vendor.moonshot", /moonshot|kimi/i],
    ["vendor.zhipu", /zhipu|glm|chatglm/i],
    ["vendor.seed", /bytedance|doubao|seedance|seedream|\bseed\b/i],
    ["vendor.baidu", /baidu|ernie|文心/i],
    ["vendor.hunyuan", /tencent|hunyuan|混元/i],
    ["vendor.minimax", /minimax/i],
    ["vendor.huawei", /huawei|ascend|昇腾/i],
    ["platform.github", /github/i],
    ["platform.hugging_face", /hugging face|huggingface/i],
    ["platform.modelscope", /modelscope/i],
    ["platform.openrouter", /openrouter/i],
    ["platform.ollama", /ollama/i],
    ["platform.aws", /\baws\b|amazon/i],
    ["hardware.nvidia", /nvidia|cuda/i],
    ["hardware.amd", /\bamd\b|rocm/i],
  ];
  const matched = matchers.find(([, pattern]) => pattern.test(haystack));
  const lineageId = matched
    ? matched[0]
    : card.type === "organization" &&
        /平台|托管|仓库|运行|api/i.test(`${card.description} ${card.realityRole ?? ""}`)
      ? "platform.github"
      : "platform.hugging_face";
  return {
    id: lineageId,
    ...generationConfig.vendorProfiles[lineageId],
  };
}

function inferStageId(card) {
  const node = nodeByCardId.get(card.id);
  if (node) {
    return node.stageId;
  }
  if (card.stageId) {
    return card.stageId;
  }
  return "current";
}

function inferOpenness(card) {
  const label = `${card.openLabel ?? ""} ${card.tags?.join(" ") ?? ""}`;
  if (/开源/.test(label)) {
    return "open_source";
  }
  if (/开放权重/.test(label)) {
    return "open_weights";
  }
  if (/开放科学/.test(label)) {
    return "open_science";
  }
  return "closed";
}

function inferAbilitySignals(card) {
  const haystack = [
    card.name,
    card.description,
    card.abilityDirections,
    ...(card.skills ?? []),
    ...(card.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  return Object.fromEntries(
    Object.entries(generationConfig.abilitySignals).map(([ability, signals]) => [
      ability,
      signals.some((signal) => haystack.toLowerCase().includes(signal.toLowerCase())),
    ]),
  );
}

function inferPowerModifier(card) {
  const haystack = [
    card.name,
    card.description,
    card.abilityDirections,
    ...(card.skills ?? []),
    ...(card.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  if (
    generationConfig.powerSignals.high.some((signal) =>
      haystack.toLowerCase().includes(signal.toLowerCase()),
    )
  ) {
    return 2;
  }
  if (
    generationConfig.powerSignals.low.some((signal) =>
      haystack.toLowerCase().includes(signal.toLowerCase()),
    )
  ) {
    return -1;
  }
  if (
    generationConfig.powerSignals.medium.some((signal) =>
      haystack.toLowerCase().includes(signal.toLowerCase()),
    )
  ) {
    return 1;
  }
  return 0;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function buildAbilities(card) {
  const stage = generationConfig.stageProfiles[inferStageId(card)] ?? {
    abilityBase: 3,
  };
  const signals = inferAbilitySignals(card);
  const modifier = inferPowerModifier(card);
  const abilities = {
    reasoning: 0,
    coding: 0,
    agent: 0,
    multimodal: 0,
  };
  for (const ability of Object.keys(abilities)) {
    if (signals[ability]) {
      abilities[ability] = clamp(stage.abilityBase + modifier, 1, 5);
    }
  }
  if (Object.values(abilities).every((value) => value === 0)) {
    for (const ability of Object.keys(abilities)) {
      abilities[ability] = clamp(stage.abilityBase, 1, 5);
    }
  }
  let total = Object.values(abilities).reduce((sum, value) => sum + value, 0);
  while (total > 18) {
    const ability = Object.keys(abilities).sort(
      (left, right) => abilities[right] - abilities[left],
    )[0];
    if (!ability || abilities[ability] <= 1) {
      break;
    }
    abilities[ability] -= 1;
    total -= 1;
  }
  return abilities;
}

function modelDesignPoints(abilities, compatibilityTags, openness) {
  const values = Object.values(abilities).sort((left, right) => right - left);
  const total = values.reduce((sum, value) => sum + value, 0);
  const focus = Math.max(0, (values[0] ?? 0) - 3) + Math.max(0, (values[1] ?? 0) - 4);
  const compatibilityAdjustment =
    compatibilityTags.length <= 1 ? -1 : compatibilityTags.length >= 3 ? 1 : 0;
  const closedPremium = openness === "closed" && total >= 12 ? 2 : 0;
  return total + focus + compatibilityAdjustment + closedPremium;
}

function raiseAbilitiesToBudget(abilities, compatibilityTags, openness) {
  let designPoints = modelDesignPoints(abilities, compatibilityTags, openness);
  while (designPoints < 5) {
    const ability = Object.keys(abilities).sort(
      (left, right) => abilities[right] - abilities[left] || left.localeCompare(right),
    )[0];
    if (!ability || abilities[ability] >= 5) {
      break;
    }
    abilities[ability] += 1;
    designPoints = modelDesignPoints(abilities, compatibilityTags, openness);
  }
  return designPoints;
}

function modelNumbers(abilities, compatibilityTags, openness) {
  const designPoints = raiseAbilitiesToBudget(abilities, compatibilityTags, openness);
  const candidates = [];
  for (let compute = 1; compute <= 8; compute += 1) {
    for (let capital = 0; capital <= 2; capital += 1) {
      const budget = 2.5 * compute + 2 * capital;
      candidates.push({
        compute,
        capital,
        deviation: (designPoints - budget) / budget,
      });
    }
  }
  const valid = candidates.filter(
    (candidate) => candidate.deviation >= -0.15 && candidate.deviation <= 0.2,
  );
  const selected = (valid.length > 0 ? valid : candidates).sort(
    (left, right) =>
      Math.abs(left.deviation) - Math.abs(right.deviation) ||
      left.compute - right.compute ||
      left.capital - right.capital,
  )[0];
  if (!selected) {
    throw new Error(`无法为模型设计点 ${designPoints} 选择费用`);
  }
  return {
    compute: selected.compute,
    capital: selected.capital,
    designPoints,
  };
}

function technologyProfile(card) {
  const haystack = [
    card.name,
    card.description,
    card.technologyCategory,
    card.gameSemantics,
    ...(card.tags ?? []),
    ...(card.skills ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  return (
    generationConfig.technologyProfiles.find(
      (profile) =>
        profile.match.length > 0 &&
        profile.match.some((signal) => haystack.toLowerCase().includes(signal.toLowerCase())),
    ) ?? generationConfig.technologyProfiles.at(-1)
  );
}

function organizationProfile(card) {
  const identity = card.gameIdentity ?? "";
  const desiredSubtype = /基础设施/.test(identity)
    ? "infrastructure"
    : /平台/.test(identity)
      ? "platform"
      : "company";
  const haystack = [
    card.name,
    card.description,
    card.realityRole,
    card.realityAnchor,
    ...(card.tags ?? []),
    ...(card.skills ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  return (
    generationConfig.organizationProfiles.find(
      (profile) =>
        profile.subtype === desiredSubtype &&
        profile.match.length > 0 &&
        profile.match.some((signal) => haystack.toLowerCase().includes(signal.toLowerCase())),
    ) ??
    generationConfig.organizationProfiles.find(
      (profile) => profile.subtype === desiredSubtype && profile.match.length === 0,
    ) ??
    generationConfig.organizationProfiles.at(-1)
  );
}

function buildCommonCard(card, type) {
  const stageId = inferStageId(card);
  const vendor = resolveVendorProfile(card);
  return {
    id: card.id,
    name: card.name,
    type,
    description: card.description,
    flavor: card.flavor,
    contentKind: "archive",
    sources: card.sources,
    balanceVersion: generationConfig.version,
    reviewStatus: "draft",
    stageId,
    lineageIds: unique([vendor.id, ...(card.lineageIds ?? [])]),
    sourceNodeId: nodeByCardId.get(card.id)?.nodeId,
  };
}

function buildOrganization(card) {
  const profile = organizationProfile(card);
  const vendor = resolveVendorProfile(card);
  const sourceTags = splitTags(card.tags?.join(",") ?? "");
  const openness = inferOpenness(card);
  const tags = unique([...vendor.tags, ...sourceTags, "organization", profile.subtype]);
  return {
    ...buildCommonCard(card, "organization"),
    subtype: profile.subtype,
    tags,
    cost: {
      compute: profile.computeCost,
      capital: profile.capitalCost,
    },
    duration: "permanent",
    faction: vendor.faction,
    openness:
      profile.subtype === "infrastructure"
        ? "closed"
        : openness === "closed" && profile.subtype === "platform"
          ? "open_source"
          : openness,
    capitalIncome: profile.capitalIncome,
    capacity: profile.capacity,
    passiveEffects: [profile.passive],
    triggeredEffects: [],
    actionSet: generationConfig.organizationActionSets[profile.actionSet],
  };
}

function buildModel(card) {
  const abilities = buildAbilities(card);
  const openness = inferOpenness(card);
  const vendor = resolveVendorProfile(card);
  const compatibilityTags = unique([
    ...vendor.modelCompatibility,
    ...(openness === "closed" ? [] : ["open_weights", "ecosystem"]),
  ]);
  const numbers = modelNumbers(abilities, compatibilityTags, openness);
  const abilityTags = Object.entries(abilities)
    .filter(([, value]) => value > 0)
    .map(([ability]) => ability);
  return {
    ...buildCommonCard(card, "asset"),
    subtype: "model",
    assetKind: "model",
    tags: unique([
      "model",
      openness,
      vendor.factionTag,
      inferStageId(card),
      ...abilityTags,
      ...(card.tags ?? []),
    ]),
    cost: {
      compute: numbers.compute,
      capital: numbers.capital,
    },
    duration: "permanent",
    abilities,
    openness,
    faction: vendor.faction,
    compatibleOrganizationTags: compatibilityTags,
    deployEffects: [],
    passiveEffects: [],
  };
}

function buildTechnology(card) {
  const profile = technologyProfile(card);
  const vendor = resolveVendorProfile(card);
  return {
    ...buildCommonCard(card, "asset"),
    subtype: "technology",
    assetKind: "technology",
    tags: unique([
      "technology",
      inferStageId(card),
      ...(card.tags ?? []),
      ...(card.id.startsWith("lineage_") ? ["lineage"] : []),
    ]),
    cost: {
      compute: profile.computeCost,
      capital: profile.capitalCost,
    },
    duration: "permanent",
    attachment: profile.attachment,
    passiveEffects: [profile.effect],
    deployEffects: [],
    lineageIds: unique([vendor.id, ...(card.lineageIds ?? [])]),
  };
}

function buildLiveCard(card) {
  if (card.type === "organization") {
    return buildOrganization(card);
  }
  if (card.type === "model") {
    return buildModel(card);
  }
  return buildTechnology(card);
}

function buildLineageCard(card) {
  const normalized = {
    ...card,
    openLabel: (card.tags ?? []).includes("open_weights") ? "开放权重" : "闭源",
    abilityDirections: card.description,
    technologyCategory: card.tags?.join(" ") ?? "",
    gameSemantics: card.description,
  };
  if (card.type === "lineage_model") {
    return buildModel(normalized);
  }
  return buildTechnology(normalized);
}

function writeCard(card) {
  const subtypeDirectory =
    card.type === "organization"
      ? "organizations"
      : card.subtype === "model"
        ? "models"
        : card.id.startsWith("lineage_")
          ? "lineage-technologies"
          : "technologies";
  const outputDirectory = join(generatedRoot, subtypeDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, `${card.id}.yaml`), `${stringify(card)}\n`, "utf8");
}

const liveCards = liveSources.flatMap(parseLiveCards);
const generatedCards = [
  ...liveCards.map(buildLiveCard),
  ...lineageData.cards.map(buildLineageCard),
];
const duplicateIds = generatedCards
  .map((card) => card.id)
  .filter((id, index, values) => values.indexOf(id) !== index);
if (duplicateIds.length > 0) {
  throw new Error(`生成内容存在重复 ID：${unique(duplicateIds).join("、")}`);
}

for (const card of generatedCards) {
  writeCard(card);
}

const byType = generatedCards.reduce((counts, card) => {
  const key =
    card.type === "organization"
      ? "organizations"
      : card.subtype === "model"
        ? "models"
        : "technologies";
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {});

console.log(
  `现实内容已生成：${generatedCards.length} 张，组织 ${byType.organizations ?? 0}，模型 ${byType.models ?? 0}，技术 ${byType.technologies ?? 0}`,
);
