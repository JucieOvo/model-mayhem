/**
 * 社区侃词同步脚本。
 *
 * 作者：JucieOvo
 *
 * 本脚本把 community-banter.json 中的逐卡文案同步回 Markdown 卡面，确保设计稿、
 * 静态阅览器和后续 Content Pack 使用同一套调侃文本。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, "..");
const contentRoot = join(projectRoot, "docs", "content", "reality-v0.2");
const communityBanterPath = join(contentRoot, "community-banter.json");
const cardFiles = [
  "organizations.md",
  "models-western.md",
  "models-china.md",
  "models-open-platforms.md",
  "technologies-architecture.md",
  "technologies-training.md",
  "technologies-systems.md",
  "technologies-agent.md",
];

const communityBanter = JSON.parse(readFileSync(communityBanterPath, "utf8"));
let updatedCards = 0;

for (const fileName of cardFiles) {
  const path = join(contentRoot, fileName);
  const markdown = readFileSync(path, "utf8");
  const headingMatches = [...markdown.matchAll(/^### (.+)$/gm)];
  const sections = [];

  for (let index = 0; index < headingMatches.length; index += 1) {
    const heading = headingMatches[index];
    const start = heading.index;
    const end = headingMatches[index + 1]?.index ?? markdown.length;
    const section = markdown.slice(start, end);
    const cardId = section.match(/^- 卡牌 ID：`([^`]+)`$/m)?.[1];
    if (!cardId) {
      throw new Error(`${fileName} 中无法识别卡牌 ID：${heading[1]}`);
    }
    const banter = communityBanter.cards[cardId];
    if (!banter) {
      throw new Error(`${fileName} 中卡牌缺少社区侃词：${cardId}`);
    }
    if (!/^- 调侃：.+$/m.test(section)) {
      throw new Error(`${fileName} 中卡牌缺少调侃字段：${cardId}`);
    }
    sections.push(section.replace(/^- 调侃：.+$/m, `- 调侃：${banter.line}`));
    updatedCards += 1;
  }

  const firstHeadingIndex = headingMatches[0]?.index;
  if (firstHeadingIndex === undefined) {
    throw new Error(`${fileName} 中没有卡牌章节`);
  }
  const output = markdown.slice(0, firstHeadingIndex) + sections.join("");
  writeFileSync(path, output, "utf8");
}

console.log(`社区侃词同步完成：${updatedCards} 张卡`);
