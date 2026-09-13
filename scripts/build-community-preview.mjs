/**
 * 社区数据分支静态查看器生成器。
 *
 * 作者：JucieOvo
 *
 * 脚本只读取指定工作树中的真实分支元数据、YAML 数据和缩略图，生成一个自包含
 * HTML。生成后的页面不请求网络，不使用模拟数据；--check 可用于确认分支预览是否
 * 与当前内容同步。
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { parse } from "yaml";

const RESOURCE_LABELS = {
  compute: "算力",
  capital: "资本",
  influence: "影响力",
};

const DURATION_LABELS = {
  one_shot: "一次性",
  permanent: "永久",
  rounds: "按轮持续",
  target_turns: "按目标回合",
  consume: "消耗",
};

const CARD_TYPE_LABELS = {
  organization: "组织",
  asset: "资产",
  action: "行动",
  world_event: "世界事件",
  question: "技术题",
};

const CARD_SUBTYPE_LABELS = {
  company: "公司",
  platform: "平台",
  infrastructure: "基础设施",
  model: "模型",
  technology: "技术",
  paper: "论文",
  community: "社区",
  market: "市场",
  product: "产品",
  benchmark: "榜单",
  response: "回应",
  openness: "开放生态",
};

const EFFECT_LABELS = {
  modify_cost: "修改费用",
  modify_income: "修改收入",
  gain_influence: "获得影响力",
  lose_influence: "失去影响力",
  draw: "抽牌",
  deploy_asset: "部署资产",
  deploy_organization: "部署组织",
  deal_damage: "造成压力",
  heal: "恢复",
  add_status: "施加状态",
  remove_status: "移除状态",
  steal_influence: "夺取影响力",
  benchmark_boost: "强化 Benchmark",
  set_flag: "设置标记",
  add_asset: "加入资产",
};

const KEY_LABELS = {
  id: "标识",
  type: "类型",
  subtype: "子类型",
  cost: "费用",
  duration: "持续时间",
  faction: "阵营",
  openness: "开放度",
  capitalIncome: "资本收入",
  capacity: "容量",
  actionSet: "行动池",
  abilities: "模型能力",
  compatibleOrganizationTags: "兼容组织标签",
  version: "版本",
  rulesetVersion: "规则版本",
  balanceId: "平衡包标识",
  influenceTarget: "影响力目标",
  roundLimit: "回合上限",
  uniqueCardTarget: "唯一卡牌目标",
  blueprintsPerDeck: "牌组蓝图数量",
  minimumModelsPerDeck: "最少模型数量",
  minimumTechnologiesPerDeck: "最少技术数量",
  maxCopiesPerCard: "同名卡上限",
  openingBlueprintHand: "初始蓝图手牌",
  blueprintDrawPerTurn: "每回合蓝图抽取",
  blueprintPityDraws: "蓝图保底间隔",
  blueprintHandLimit: "蓝图手牌上限",
  openingActionHandFirst: "先手初始行动牌",
  openingActionHandSecond: "后手初始行动牌",
  actionDrawPerTurn: "每回合行动抽取",
  actionHandLimit: "行动手牌上限",
  anchorSlots: "组织槽位",
  homeLabCapacity: "主实验室容量",
  organizationDeploysPerTurn: "每回合组织部署",
  assetDeploysPerTurn: "每回合资产部署",
  benchmarksPerTurn: "每回合 Benchmark",
  techChecksPerTurn: "每回合技术检定",
  signatureSlots: "招牌行动槽位",
  capitalBaseIncome: "基础资本收入",
  capitalLimit: "资本上限",
  computeBase: "基础算力",
  computeLimit: "算力上限",
  influenceGainPerRoundLimit: "每回合影响力获取上限",
  durationRounds: "持续轮数",
  reviewStatus: "审查状态",
  contentKind: "内容类型",
  balanceVersion: "平衡版本",
  branch: "研究分支",
  depth: "深度",
  prerequisiteId: "前置节点",
  rewardCardIds: "奖励卡",
  completionCategory: "完成类别",
  lineageIds: "谱系来源",
  order: "顺序",
  initial: "初始时代",
  requirements: "推进要求",
  nextEraId: "下一时代",
  doctrineId: "方针",
  blueprintCardIds: "蓝图卡",
  signatureActionIds: "招牌行动",
  description: "描述",
  tags: "标签",
  startingUnlock: "初始解锁",
  targeting: "目标规则",
  signature: "招牌行动",
};

function parseArguments(values) {
  const result = { check: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--root") {
      result.root = values[index + 1];
      index += 1;
      continue;
    }
    if (value === "--mode") {
      result.mode = values[index + 1];
      index += 1;
      continue;
    }
    if (value === "--output") {
      result.output = values[index + 1];
      index += 1;
      continue;
    }
    if (value === "--check") {
      result.check = true;
      continue;
    }
    throw new Error(`未知参数：${value}`);
  }
  if (!result.root) {
    throw new Error("必须通过 --root 指定数据分支工作树");
  }
  if (result.mode && !["content", "balance"].includes(result.mode)) {
    throw new Error(`--mode 只支持 content 或 balance，收到：${result.mode}`);
  }
  return result;
}

function toPosix(path) {
  return path.split(sep).join("/");
}

function readYaml(path) {
  try {
    return parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读取 YAML 失败：${path}；${message}`);
  }
}

function listFiles(root) {
  if (!existsSync(root)) {
    return [];
  }
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`预览数据不能包含符号链接：${path}`);
      }
      if (entry.isDirectory()) {
        if (entry.name !== ".git") {
          visit(path);
        }
        continue;
      }
      if (entry.isFile()) {
        files.push(path);
      }
    }
  };
  visit(root);
  return files.sort((left, right) => toPosix(left).localeCompare(toPosix(right)));
}

function listYamlFiles(root) {
  return listFiles(root).filter((path) => extname(path).toLowerCase() === ".yaml");
}

function readYamlDirectory(root) {
  return listYamlFiles(root).map((path) => ({
    path: toPosix(relative(root, path)),
    absolutePath: path,
    data: readYaml(path),
  }));
}

function readBranchMetadata(root) {
  const path = join(root, ".modelmayhem", "branch.yaml");
  if (!existsSync(path)) {
    throw new Error(`数据分支缺少元数据：${path}`);
  }
  const value = readYaml(path);
  if (!value || typeof value !== "object" || typeof value.id !== "string") {
    throw new Error(`数据分支元数据无效：${path}`);
  }
  return value;
}

function readManifest(root) {
  const files = listYamlFiles(join(root, "content", "manifest"));
  if (files.length !== 1) {
    throw new Error(`内容清单必须恰好一份，当前为 ${files.length} 份`);
  }
  return readYaml(files[0]);
}

function computeSourceFingerprint(root, managedPaths) {
  const hash = createHash("sha256");
  const paths = [];
  for (const managedPath of managedPaths) {
    const absolute = join(root, managedPath);
    if (!existsSync(absolute)) {
      continue;
    }
    const stat = statSync(absolute);
    if (stat.isFile()) {
      paths.push(absolute);
      continue;
    }
    paths.push(...listFiles(absolute));
  }
  for (const path of [...new Set(paths)].sort((left, right) =>
    toPosix(left).localeCompare(toPosix(right)),
  )) {
    const relativePath = toPosix(relative(root, path));
    const extension = extname(path).toLowerCase();
    const bytes = [".csv", ".json", ".md", ".txt", ".yaml", ".yml"].includes(extension)
      ? Buffer.from(readFileSync(path, "utf8").replaceAll("\r\n", "\n"), "utf8")
      : readFileSync(path);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function labelFrom(map, value, fallback = "未知") {
  return typeof value === "string" ? (map[value] ?? value) : fallback;
}

function humanKey(key) {
  return KEY_LABELS[key] ?? key.replaceAll("_", " ");
}

function formatScalar(value) {
  if (value === null || value === undefined) {
    return "无";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (typeof value === "number" || typeof value === "string") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(formatScalar).join("、");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, entry]) => `${humanKey(key)}：${formatScalar(entry)}`)
      .join("；");
  }
  return String(value);
}

function formatCost(cost) {
  if (!cost || typeof cost !== "object") {
    return "无";
  }
  const parts = Object.entries(cost)
    .filter(([, amount]) => typeof amount === "number" && amount !== 0)
    .map(([resource, amount]) => `${RESOURCE_LABELS[resource] ?? resource} ${amount}`);
  return parts.length > 0 ? parts.join(" / ") : "无";
}

function formatSelector(selector) {
  if (!selector || typeof selector !== "object") {
    return null;
  }
  const entries = Object.entries(selector).map(
    ([key, value]) => `${humanKey(key)}：${formatScalar(value)}`,
  );
  return entries.length > 0 ? entries.join("；") : null;
}

function formatEffect(effect, index) {
  if (!effect || typeof effect !== "object") {
    return `${index + 1}. ${formatScalar(effect)}`;
  }
  const parts = [labelFrom(EFFECT_LABELS, effect.kind, "效果")];
  if (effect.target !== undefined) {
    parts.push(`目标 ${formatScalar(effect.target)}`);
  }
  if (effect.amount !== undefined) {
    parts.push(`数值 ${formatScalar(effect.amount)}`);
  }
  if (effect.resource !== undefined) {
    parts.push(`资源 ${labelFrom(RESOURCE_LABELS, effect.resource, effect.resource)}`);
  }
  if (effect.deck !== undefined) {
    parts.push(`牌堆 ${formatScalar(effect.deck)}`);
  }
  if (effect.durationRounds !== undefined) {
    parts.push(`持续 ${formatScalar(effect.durationRounds)} 轮`);
  }
  if (effect.frequency !== undefined) {
    parts.push(`频率 ${formatScalar(effect.frequency)}`);
  }
  if (effect.status !== undefined) {
    parts.push(`状态 ${formatScalar(effect.status)}`);
  }
  const selector = formatSelector(effect.selector);
  if (selector) {
    parts.push(`选择器 ${selector}`);
  }
  return `${index + 1}. ${parts.join("；")}`;
}

function formatEffectList(effects) {
  return Array.isArray(effects) ? effects.map(formatEffect) : [];
}

function countById(values) {
  const counts = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, count]) => (count === 1 ? id : `${id} ×${count}`));
}

function mimeType(path) {
  const extension = extname(path).toLowerCase();
  return (
    {
      ".avif": "image/avif",
      ".gif": "image/gif",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
    }[extension] ?? "application/octet-stream"
  );
}

function resolveThumbnail(root, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  const candidate = normalized.startsWith("content/")
    ? resolve(root, normalized)
    : resolve(root, "content", normalized);
  const relativePath = toPosix(relative(root, candidate));
  if (relativePath.startsWith("../") || !existsSync(candidate)) {
    return null;
  }
  const bytes = readFileSync(candidate);
  return `data:${mimeType(candidate)};base64,${bytes.toString("base64")}`;
}

function field(label, value) {
  if (value === null || value === undefined || value === "" || value === "无") {
    return null;
  }
  return { label, value: formatScalar(value) };
}

function section(title, value) {
  if (!value || (Array.isArray(value) && value.length === 0)) {
    return null;
  }
  return { title, ...value };
}

function makeRecord({
  id,
  kind,
  kindLabel,
  name,
  summary,
  path,
  chips = [],
  fields = [],
  sections = [],
  thumbnail = null,
}) {
  return {
    id,
    kind,
    kindLabel,
    name: name || id,
    summary: summary || "",
    path,
    chips: chips.filter(Boolean),
    fields: fields.filter(Boolean),
    sections: sections.filter(Boolean),
    thumbnail,
  };
}

function buildContentRecords(root) {
  const records = [];
  for (const { path, data } of readYamlDirectory(join(root, "content", "presentation", "cards"))) {
    const banter = Array.isArray(data.banter) ? data.banter.filter(Boolean) : [];
    records.push(
      makeRecord({
        id: data.id,
        kind: "card",
        kindLabel: "卡面展示",
        name: data.name,
        summary: data.description || data.flavor || data.id,
        path,
        fields: [field("标识", data.id), field("来源文件", path)],
        sections: [
          section("简介", data.description ? { paragraphs: [data.description] } : null),
          section("侃词", data.flavor ? { paragraphs: [data.flavor] } : null),
          section("追加侃词", banter.length > 0 ? { items: banter } : null),
        ],
        thumbnail: resolveThumbnail(root, data.thumbnail),
      }),
    );
  }
  for (const { path, data } of readYamlDirectory(join(root, "content", "questions"))) {
    const options = Array.isArray(data.options)
      ? data.options.map((option) => ({
          id: option.id,
          text: option.text,
          correct: option.id === data.correctOptionId,
        }))
      : [];
    const correct = options.find((option) => option.correct);
    records.push(
      makeRecord({
        id: data.id,
        kind: "question",
        kindLabel: "技术题",
        name: data.prompt,
        summary: data.sourceNote || data.explanation || data.id,
        path,
        fields: [
          field("标识", data.id),
          field("正确答案", correct ? `${correct.id}. ${correct.text}` : data.correctOptionId),
        ],
        sections: [
          section("选项", options.length > 0 ? { options } : null),
          section("解释", data.explanation ? { paragraphs: [data.explanation] } : null),
          section("来源说明", data.sourceNote ? { paragraphs: [data.sourceNote] } : null),
        ],
      }),
    );
  }
  return records;
}

function balanceCardKind(data) {
  if (data.type === "asset" && data.assetKind === "model") {
    return { kind: "model", label: "模型" };
  }
  if (data.type === "asset" && data.assetKind === "technology") {
    return { kind: "technology", label: "技术" };
  }
  if (data.type === "asset" && data.assetKind === "paper") {
    return { kind: "paper", label: "论文" };
  }
  return {
    kind: String(data.type || "card"),
    label: labelFrom(CARD_TYPE_LABELS, data.type, "卡牌"),
  };
}

function buildBalanceCardRecord(document) {
  const { path, data } = document;
  const kind = balanceCardKind(data);
  const fields = [
    field("标识", data.id),
    field(
      "类型",
      `${labelFrom(CARD_TYPE_LABELS, data.type, data.type)} / ${labelFrom(CARD_SUBTYPE_LABELS, data.subtype, data.subtype)}`,
    ),
    field("费用", formatCost(data.cost)),
    field("持续时间", labelFrom(DURATION_LABELS, data.duration, data.duration)),
    field("阵营", data.faction),
    field("开放度", data.openness),
    field("资本收入", data.capitalIncome),
    field("容量", data.capacity),
  ];
  const sections = [
    section(
      "模型能力",
      data.abilities
        ? {
            facts: [
              field("推理", data.abilities.reasoning),
              field("编程", data.abilities.coding),
              field("代理", data.abilities.agent),
              field("多模态", data.abilities.multimodal),
            ].filter(Boolean),
          }
        : null,
    ),
    section(
      "部署效果",
      Array.isArray(data.deployEffects) && data.deployEffects.length > 0
        ? { effects: formatEffectList(data.deployEffects) }
        : null,
    ),
    section(
      "被动效果",
      Array.isArray(data.passiveEffects) && data.passiveEffects.length > 0
        ? { effects: formatEffectList(data.passiveEffects) }
        : null,
    ),
    section(
      "触发效果",
      Array.isArray(data.triggeredEffects) && data.triggeredEffects.length > 0
        ? {
            items: data.triggeredEffects.map(
              (triggered) =>
                `触发 ${formatScalar(triggered.trigger)}：${formatEffectList(triggered.effects).join("；")}`,
            ),
          }
        : null,
    ),
    section(
      "行动效果",
      Array.isArray(data.effects) && data.effects.length > 0
        ? { effects: formatEffectList(data.effects) }
        : null,
    ),
    section(
      "行动池",
      Array.isArray(data.actionSet) && data.actionSet.length > 0 ? { items: data.actionSet } : null,
    ),
    section(
      "技术检定",
      data.techCheck
        ? {
            facts: [field("题目", data.techCheck.questionId)].filter(Boolean),
            items: [
              ...formatEffectList(data.techCheck.baseEffects).map((line) => `基础：${line}`),
              ...formatEffectList(data.techCheck.enhancedEffects).map((line) => `强化：${line}`),
            ],
          }
        : null,
    ),
    section(
      "兼容组织标签",
      Array.isArray(data.compatibleOrganizationTags) && data.compatibleOrganizationTags.length > 0
        ? { items: data.compatibleOrganizationTags }
        : null,
    ),
  ];
  return makeRecord({
    id: data.id,
    kind: kind.kind,
    kindLabel: kind.label,
    name: data.id,
    summary: `${kind.label} / ${labelFrom(CARD_SUBTYPE_LABELS, data.subtype, data.subtype)}`,
    path,
    chips: Array.isArray(data.tags) ? data.tags : [],
    fields,
    sections,
  });
}

function buildBalanceConfigRecords(root) {
  return readYamlDirectory(join(root, "content", "balance")).map(({ path, data }) => {
    const fields = [];
    const sections = [];
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object") {
        if (Array.isArray(value)) {
          sections.push(section(humanKey(key), { items: value.map(formatScalar) }));
        } else {
          sections.push(
            section(humanKey(key), {
              facts: Object.entries(value)
                .map(([nestedKey, nestedValue]) =>
                  field(humanKey(nestedKey), formatScalar(nestedValue)),
                )
                .filter(Boolean),
            }),
          );
        }
      } else {
        fields.push(field(humanKey(key), value));
      }
    }
    return makeRecord({
      id: `${data.id ?? basename(path, ".yaml")}-balance`,
      kind: "balance",
      kindLabel: "平衡参数",
      name: data.id || basename(path, ".yaml"),
      summary: `版本 ${data.version ?? "未知"}`,
      path,
      fields,
      sections,
    });
  });
}

function buildDeckRecords(root) {
  return readYamlDirectory(join(root, "content", "decks")).map(({ path, data }) =>
    makeRecord({
      id: data.id,
      kind: "deck",
      kindLabel: "预组",
      name: data.name || data.id,
      summary: data.description || data.id,
      path,
      fields: [
        field("阵营", data.faction),
        field("方针", data.doctrineId),
        field("蓝图数量", countById(data.blueprintCardIds).length),
      ],
      sections: [
        section("蓝图", { items: countById(data.blueprintCardIds) }),
        section(
          "招牌行动",
          Array.isArray(data.signatureActionIds) && data.signatureActionIds.length > 0
            ? { items: data.signatureActionIds }
            : null,
        ),
        section("说明", data.description ? { paragraphs: [data.description] } : null),
      ],
    }),
  );
}

function buildResearchRecords(root) {
  return readYamlDirectory(join(root, "content", "research")).map(({ path, data }) =>
    makeRecord({
      id: data.id,
      kind: "research",
      kindLabel: "研究节点",
      name: data.name || data.id,
      summary: data.description || data.id,
      path,
      fields: [
        field("研究分支", data.branch),
        field("深度", data.depth),
        field("成本", data.cost),
        field("前置节点", data.prerequisiteId),
        field("完成类别", data.completionCategory),
      ],
      sections: [
        section(
          "奖励卡",
          Array.isArray(data.rewardCardIds) && data.rewardCardIds.length > 0
            ? { items: data.rewardCardIds }
            : null,
        ),
        section(
          "谱系来源",
          Array.isArray(data.lineageIds) && data.lineageIds.length > 0
            ? { items: data.lineageIds }
            : null,
        ),
        section("说明", data.description ? { paragraphs: [data.description] } : null),
      ],
    }),
  );
}

function buildEraRecords(root) {
  return readYamlDirectory(join(root, "content", "eras")).map(({ path, data }) =>
    makeRecord({
      id: data.id,
      kind: "era",
      kindLabel: "时代",
      name: data.name || data.id,
      summary: `顺序 ${data.order}${data.initial ? " / 初始时代" : ""}`,
      path,
      fields: [
        field("顺序", data.order),
        field("初始时代", data.initial),
        field("下一时代", data.nextEraId),
      ],
      sections: [
        section(
          "推进要求",
          data.requirements
            ? {
                facts: Object.entries(data.requirements).map(([key, value]) =>
                  field(humanKey(key), value),
                ),
              }
            : null,
        ),
      ],
    }),
  );
}

function buildDoctrineRecords(root) {
  return readYamlDirectory(join(root, "content", "doctrines")).map(({ path, data }) =>
    makeRecord({
      id: data.id,
      kind: "doctrine",
      kindLabel: "方针",
      name: data.name || data.id,
      summary: data.description || data.id,
      path,
      chips: Array.isArray(data.tags) ? data.tags : [],
      fields: [field("初始解锁", data.startingUnlock)],
      sections: [section("说明", data.description ? { paragraphs: [data.description] } : null)],
    }),
  );
}

function buildBalanceRecords(root) {
  const records = [];
  for (const document of readYamlDirectory(join(root, "content", "cards"))) {
    records.push(buildBalanceCardRecord(document));
  }
  records.push(...buildBalanceConfigRecords(root));
  records.push(...buildDeckRecords(root));
  records.push(...buildResearchRecords(root));
  records.push(...buildEraRecords(root));
  records.push(...buildDoctrineRecords(root));
  return records;
}

function buildMeta(root, mode, metadata, manifest, records) {
  const counts = {};
  for (const record of records) {
    counts[record.kindLabel] = (counts[record.kindLabel] ?? 0) + 1;
  }
  return {
    title: mode === "content" ? "内容社区分支预览" : "数值社区分支预览",
    subtitle:
      mode === "content" ? "卡面、侃词、技术题与媒体展示" : "卡牌效果、预组、研究、时代与平衡参数",
    branch: metadata.id,
    role: metadata.role,
    status: metadata.status,
    promotesTo: metadata.promotesTo ?? metadata.receivesFrom ?? null,
    version: manifest.version ?? "未知",
    rulesetVersion: manifest.rulesetVersion ?? "未知",
    fingerprint: computeSourceFingerprint(root, metadata.managedPaths ?? []),
    counts,
    recordCount: records.length,
  };
}

function renderHtml(payload) {
  const serialized = JSON.stringify(payload).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${payload.meta.branch} - ${payload.meta.title}</title>
  <style>${STYLE}</style>
</head>
<body>
  <header class="topbar">
    <div class="identity">
      <div class="eyebrow" id="role"></div>
      <h1 id="title"></h1>
      <p id="subtitle"></p>
    </div>
    <div class="branch-meta" id="branch-meta"></div>
  </header>
  <section class="toolbar">
    <label class="search">
      <span>搜索</span>
      <input id="search" type="search" autocomplete="off" placeholder="名称、标识、侃词或路径">
    </label>
    <div class="filters" id="filters"></div>
  </section>
  <main class="layout">
    <section class="list-panel">
      <div class="list-heading">
        <div>
          <strong id="list-title">条目</strong>
          <span id="visible-count"></span>
        </div>
        <span class="fingerprint" id="fingerprint"></span>
      </div>
      <div class="record-grid" id="grid"></div>
    </section>
    <aside class="detail-panel" id="detail"></aside>
  </main>
  <script id="preview-data" type="application/json">${serialized}</script>
  <script>${CLIENT_SCRIPT}</script>
</body>
</html>
`;
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  const root = resolve(args.root);
  const metadata = readBranchMetadata(root);
  const inferredMode = metadata.role === "content" ? "content" : "balance";
  const mode = args.mode ?? inferredMode;
  if (mode !== inferredMode) {
    throw new Error(`分支角色 ${metadata.role} 与请求模式 ${mode} 不一致`);
  }
  const output = resolve(args.output ?? join(root, "preview.html"));
  const manifest = readManifest(root);
  const records = mode === "content" ? buildContentRecords(root) : buildBalanceRecords(root);
  const payload = {
    meta: buildMeta(root, mode, metadata, manifest, records),
    records,
  };
  const html = renderHtml(payload);
  if (args.check) {
    if (!existsSync(output)) {
      throw new Error(`预览文件不存在：${output}`);
    }
    const current = readFileSync(output, "utf8");
    if (current !== html) {
      throw new Error(`预览文件与当前数据不一致：${output}`);
    }
    console.log(`预览已同步：${output}`);
    return;
  }
  writeFileSync(output, html, "utf8");
  console.log(
    `已生成 ${mode} 预览：${output}；记录 ${records.length} 条，数据指纹 ${payload.meta.fingerprint.slice(0, 12)}`,
  );
}

const STYLE = `
:root {
  color-scheme: dark;
  --bg: #0f1315;
  --panel: #151b1e;
  --panel-strong: #1b2326;
  --line: #2a3538;
  --line-strong: #3b484c;
  --text: #edf3f1;
  --muted: #98a7a3;
  --accent: #5fc6b2;
  --accent-soft: rgba(95, 198, 178, 0.14);
  --amber: #d8a85f;
  --danger: #e58f83;
  font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
}
* {
  box-sizing: border-box;
}
html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
}
button,
input {
  font: inherit;
}
body {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 18px 24px 14px;
  border-bottom: 1px solid var(--line);
  background: #121719;
}
.identity h1 {
  margin: 2px 0 0;
  font-size: 24px;
  line-height: 1.2;
}
.identity p {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 14px;
}
.eyebrow {
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.branch-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.meta-pill {
  padding: 6px 9px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--line);
  background: #121719;
}
.search {
  display: grid;
  grid-template-columns: auto minmax(220px, 360px);
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-size: 13px;
}
.search input {
  width: 100%;
  min-width: 0;
  padding: 9px 11px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  outline: none;
  background: #0d1113;
  color: var(--text);
}
.search input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.filters {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 7px;
}
.filter {
  padding: 7px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.filter:hover,
.filter.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text);
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 410px);
  min-height: 0;
}
.list-panel,
.detail-panel {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.list-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border-right: 1px solid var(--line);
}
.list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 13px;
}
.list-heading strong {
  margin-right: 8px;
  color: var(--text);
}
.fingerprint {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.record-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  align-content: start;
  gap: 12px;
  min-height: 0;
  padding: 16px 20px 28px;
  overflow: auto;
}
.record-card {
  display: grid;
  grid-template-rows: auto auto minmax(48px, auto) auto;
  gap: 9px;
  min-height: 190px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.record-card:hover,
.record-card.selected {
  border-color: var(--accent);
  background: var(--panel-strong);
}
.record-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.card-topline,
.card-bottomline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--muted);
  font-size: 12px;
}
.kind {
  color: var(--accent);
  font-weight: 700;
}
.record-card h3 {
  margin: 0;
  font-size: 17px;
  line-height: 1.3;
  word-break: break-word;
}
.record-card p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.mini-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mini-field,
.chip {
  padding: 3px 7px;
  border: 1px solid var(--line-strong);
  border-radius: 4px;
  color: var(--muted);
  font-size: 11px;
}
.thumbnail {
  width: 100%;
  aspect-ratio: 16 / 7;
  object-fit: cover;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #0c1012;
}
.detail-panel {
  padding: 20px 22px 32px;
  overflow: auto;
  background: #111719;
}
.detail-header {
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
}
.detail-header h2 {
  margin: 7px 0 0;
  font-size: 25px;
  line-height: 1.25;
  word-break: break-word;
}
.detail-header p {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.6;
}
.detail-thumbnail {
  width: 100%;
  max-height: 230px;
  margin-top: 15px;
  object-fit: cover;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 16px;
}
.fact {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
}
.fact dt {
  margin-bottom: 5px;
  color: var(--muted);
  font-size: 11px;
}
.fact dd {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}
.detail-section {
  margin-top: 22px;
}
.detail-section h3 {
  margin: 0 0 10px;
  color: var(--amber);
  font-size: 14px;
}
.detail-section p,
.detail-section li {
  color: #c8d2cf;
  font-size: 14px;
  line-height: 1.7;
}
.detail-section p {
  margin: 0 0 8px;
}
.detail-section ul {
  margin: 0;
  padding-left: 20px;
}
.effects {
  display: grid;
  gap: 8px;
}
.effect {
  padding: 9px 10px;
  border-left: 3px solid var(--accent);
  background: var(--panel);
  color: #c8d2cf;
  font-size: 13px;
  line-height: 1.55;
}
.option {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 9px;
  margin-bottom: 8px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
}
.option.correct {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.option-id {
  color: var(--amber);
  font-weight: 700;
  text-transform: uppercase;
}
.empty {
  display: grid;
  min-height: 180px;
  place-items: center;
  color: var(--muted);
  text-align: center;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
@media (max-width: 1050px) {
  .layout {
    grid-template-columns: minmax(0, 1fr) 350px;
  }
  .record-grid {
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  }
}
@media (max-width: 780px) {
  body {
    overflow: auto;
  }
  .topbar,
  .toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
  .branch-meta {
    justify-content: flex-start;
  }
  .search {
    grid-template-columns: 1fr;
    width: 100%;
  }
  .layout {
    grid-template-columns: 1fr;
    overflow: visible;
  }
  .list-panel {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .record-grid,
  .detail-panel {
    overflow: visible;
  }
}
`;

const CLIENT_SCRIPT = `
(() => {
  const payload = JSON.parse(document.getElementById("preview-data").textContent);
  const meta = payload.meta;
  const records = payload.records;
  const state = { kind: "all", query: "", selectedId: null };
  const grid = document.getElementById("grid");
  const detail = document.getElementById("detail");
  const filters = document.getElementById("filters");
  const search = document.getElementById("search");
  const visibleCount = document.getElementById("visible-count");
  const listTitle = document.getElementById("list-title");
  const title = document.getElementById("title");
  const subtitle = document.getElementById("subtitle");
  const role = document.getElementById("role");
  const branchMeta = document.getElementById("branch-meta");
  const fingerprint = document.getElementById("fingerprint");

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    return node;
  }

  function pill(text) {
    return element("span", "meta-pill", text);
  }

  function matches(record) {
    if (state.kind !== "all" && record.kind !== state.kind) {
      return false;
    }
    if (!state.query) {
      return true;
    }
    const haystack = [
      record.id,
      record.name,
      record.kindLabel,
      record.summary,
      record.path,
      ...(record.chips || []),
      ...(record.fields || []).flatMap((item) => [item.label, item.value]),
      ...(record.sections || []).flatMap((section) =>
        [
          section.title,
          ...(section.paragraphs || []),
          ...(section.items || []),
          ...(section.effects || []),
          ...(section.options || []).flatMap((option) => [option.id, option.text]),
          ...(section.facts || []).flatMap((item) => [item.label, item.value]),
        ].filter(Boolean),
      ),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(state.query.toLocaleLowerCase());
  }

  function renderFilters() {
    filters.replaceChildren();
    const counts = new Map();
    for (const record of records) {
      counts.set(record.kind, (counts.get(record.kind) || 0) + 1);
    }
    const entries = [["all", "全部", records.length], ...counts.entries()].map(
      ([kind, count]) => {
        const label =
          kind === "all"
            ? "全部"
            : records.find((record) => record.kind === kind)?.kindLabel || kind;
        return [kind, label, count];
      },
    );
    for (const [kind, label, count] of entries) {
      const button = element("button", "filter", label + " " + count);
      button.type = "button";
      button.classList.toggle("active", state.kind === kind);
      button.addEventListener("click", () => {
        state.kind = kind;
        renderFilters();
        renderGrid();
      });
      filters.append(button);
    }
  }

  function renderMiniFields(record) {
    const row = element("div", "mini-fields");
    for (const item of (record.fields || []).slice(0, 4)) {
      row.append(element("span", "mini-field", item.label + " " + item.value));
    }
    return row;
  }

  function renderCard(record) {
    const button = element("button", "record-card");
    button.type = "button";
    button.dataset.recordId = record.id;
    button.classList.toggle("selected", state.selectedId === record.id);
    if (record.thumbnail) {
      const image = element("img", "thumbnail");
      image.src = record.thumbnail;
      image.alt = record.name;
      image.loading = "lazy";
      button.append(image);
    }
    const top = element("div", "card-topline");
    top.append(element("span", "kind", record.kindLabel), element("span", "", record.id));
    button.append(top);
    button.append(element("h3", "", record.name));
    button.append(element("p", "", record.summary));
    const bottom = element("div", "card-bottomline");
    bottom.append(renderMiniFields(record));
    button.append(bottom);
    button.addEventListener("click", () => selectRecord(record.id));
    return button;
  }

  function renderFact(item) {
    const wrapper = element("dl", "fact");
    wrapper.append(element("dt", "", item.label), element("dd", "", item.value));
    return wrapper;
  }

  function renderSection(section) {
    const wrapper = element("section", "detail-section");
    wrapper.append(element("h3", "", section.title));
    if (section.paragraphs) {
      for (const paragraph of section.paragraphs) {
        wrapper.append(element("p", "", paragraph));
      }
    }
    if (section.items) {
      const list = element("ul");
      for (const item of section.items) {
        list.append(element("li", "", item));
      }
      wrapper.append(list);
    }
    if (section.effects) {
      const effects = element("div", "effects");
      for (const effect of section.effects) {
        effects.append(element("div", "effect", effect));
      }
      wrapper.append(effects);
    }
    if (section.options) {
      for (const option of section.options) {
        const row = element("div", "option" + (option.correct ? " correct" : ""));
        row.append(element("span", "option-id", option.id), element("span", "", option.text));
        wrapper.append(row);
      }
    }
    if (section.facts) {
      const facts = element("div", "detail-grid");
      for (const item of section.facts) {
        facts.append(renderFact(item));
      }
      wrapper.append(facts);
    }
    return wrapper;
  }

  function renderDetail(record) {
    detail.replaceChildren();
    if (!record) {
      detail.append(element("div", "empty", "选择一条记录查看完整信息。"));
      return;
    }
    const header = element("header", "detail-header");
    header.append(element("div", "eyebrow", record.kindLabel + " / " + record.id));
    header.append(element("h2", "", record.name));
    if (record.summary) {
      header.append(element("p", "", record.summary));
    }
    detail.append(header);
    if (record.thumbnail) {
      const image = element("img", "detail-thumbnail");
      image.src = record.thumbnail;
      image.alt = record.name;
      detail.append(image);
    }
    if (record.chips && record.chips.length > 0) {
      const chips = element("div", "chips");
      for (const chip of record.chips) {
        chips.append(element("span", "chip", chip));
      }
      detail.append(chips);
    }
    if (record.fields && record.fields.length > 0) {
      const facts = element("div", "detail-grid");
      for (const item of record.fields) {
        facts.append(renderFact(item));
      }
      detail.append(facts);
    }
    for (const section of record.sections || []) {
      detail.append(renderSection(section));
    }
  }

  function selectRecord(id) {
    state.selectedId = id;
    for (const card of grid.querySelectorAll(".record-card")) {
      card.classList.toggle("selected", card.dataset.recordId === id);
    }
    renderDetail(records.find((record) => record.id === id) || null);
    history.replaceState(null, "", "#" + encodeURIComponent(id));
  }

  function renderGrid() {
    const filtered = records.filter(matches);
    grid.replaceChildren();
    visibleCount.textContent = "显示 " + filtered.length + " / " + records.length;
    listTitle.textContent = state.kind === "all" ? "全部条目" : "筛选条目";
    if (filtered.length === 0) {
      grid.append(element("div", "empty", "没有匹配当前条件的记录。"));
      renderDetail(null);
      return;
    }
    for (const record of filtered) {
      grid.append(renderCard(record));
    }
    const selectedVisible = filtered.some((record) => record.id === state.selectedId);
    if (!selectedVisible) {
      state.selectedId = filtered[0].id;
    }
    selectRecord(state.selectedId);
  }

  title.textContent = meta.title;
  subtitle.textContent = meta.subtitle;
  role.textContent = meta.branch + " / " + meta.status;
  branchMeta.append(
    pill("版本 " + meta.version),
    pill("规则 " + meta.rulesetVersion),
    pill("条目 " + meta.recordCount),
  );
  if (meta.promotesTo) {
    branchMeta.append(pill("去向 " + meta.promotesTo));
  }
  fingerprint.textContent = "数据指纹 " + meta.fingerprint.slice(0, 16);

  search.addEventListener("input", () => {
    state.query = search.value.trim();
    renderGrid();
  });

  renderFilters();
  const initialId = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (initialId && records.some((record) => record.id === initialId)) {
    state.selectedId = initialId;
  }
  renderGrid();
})();
`;

main();
