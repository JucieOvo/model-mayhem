/**
 * 对局全局广播。
 *
 * 作者：JucieOvo
 *
 * 广播只根据公开状态变化生成，不修改或预测规则结果。陪练 Agent 当前没有发送
 * 消息的工具，因此涉及它的内容全部由系统解说生成，不冒充 Agent 的真实输出。
 * 卡牌台词使用固定文案池，并通过对局、轮次和事件内容生成稳定哈希，因此同一
 * 事件在回放中保持一致。
 */

import type { BenchmarkResult } from "@modelmayhem/model-mayhem-rules";
import { Radio, Sparkles, Swords } from "lucide-react";
import type { ContentResponse } from "../../api";

type BattleCardInfo = ContentResponse["cards"][number];

export type BattleBroadcastTone = "news" | "agent" | "player" | "card" | "system";

export interface BattleBroadcastMessage {
  readonly id: string;
  readonly tone: BattleBroadcastTone;
  readonly label: string;
  readonly title: string;
  readonly body: string;
  readonly round: number;
  readonly createdAt: string;
  readonly source: "system";
}

export type BattleBroadcastChange =
  | {
      readonly kind: "match_started";
    }
  | {
      readonly kind: "world_event";
      readonly cardId: string;
      readonly expiresAfterRound: number;
    }
  | {
      readonly kind: "organization_deployed";
      readonly cardId: string;
      readonly ownerSeatId: string;
    }
  | {
      readonly kind: "asset_deployed";
      readonly cardId: string;
      readonly ownerSeatId: string;
    }
  | {
      readonly kind: "benchmark";
      readonly benchmark: BenchmarkResult;
    }
  | {
      readonly kind: "turn";
      readonly activeSeatId: string | null;
      readonly playerInfluence: number;
      readonly opponentInfluence: number;
    }
  | {
      readonly kind: "draw";
      readonly playerCount: number;
      readonly opponentCount: number;
    };

const cardBroadcastLines: Readonly<Record<string, readonly string[]>> = {
  deepseek: [
    "800 万美元的团队，正在和数亿美元的预算正面比拼。气不气？",
    "训练还在继续，请前排观众不要在机房门口排队。",
  ],
  open_reasoning: [
    "权重已经公开，参数规模税突然显得有点尴尬。",
    "推理能力上线，显存表示自己才是最终裁判。",
  ],
  frontier_code_agent: [
    "它修好了测试，也顺手把测试改成了自己喜欢的样子。",
    "代码任务已接管，下一步是让需求文档主动道歉。",
  ],
  frontier_reasoning: [
    "思考时间已经计入交付周期，但排行榜显然不看工时。",
    "它正在想一个所有人都没问的问题。",
  ],
  multimodal_frontier: [
    "它能理解视频，但暂时还不理解视频为什么这么长。",
    "图像、文本和视频都看懂了，只有账单没有看懂。",
  ],
  openai: ["先把模型发布，再研究价格表为什么又变了。", "闭源前沿实验室上线，API 价格表开始紧张。"],
  anthropic: [
    "安全团队请先提交影响评估，再提交性能排行榜。",
    "对齐能力上线，模型先问这个请求是否真的必要。",
  ],
  nvidia: [
    "今天没有算力短缺，只有交付周期比较有想象力。",
    "更多 GPU 已到账，电费正在申请参与对局。",
  ],
  hugging_face: [
    "模型卡写清楚以后，社区少问了三轮上下文长度。",
    "开放权重生态上线，许可证开始进行阅读理解。",
  ],
  moe: ["不是所有专家都需要同时上班。", "专家已经就位，路由正在决定谁今天加班。"],
  grpo: [
    "一组答案里总有更好的那个，也总有被当成反面教材的那个。",
    "奖励模型已经上线，现在只差定义什么叫做奖励。",
  ],
  flash_attention: [
    "同样的问题，减少了来回搬运中间结果的次数。",
    "注意力没有被优化掉，只是搬运工少跑了几个来回。",
  ],
  speculative_decoding: [
    "先猜，再验证，猜得快也是一种吞吐。",
    "推测解码上线，接受率正在假装一切都在计划内。",
  ],
  headline_benchmark: [
    "排行榜刷新了，争议区也刷新了。",
    "题目没变，压力从模型参数来到了运行预算。",
  ],
  price_cut: ["价格下降的消息比新模型更快到达用户。", "API 降价生效，利润表暂时退出群聊。"],
};

const agentTaunts = {
  ahead: [
    "别急，排行榜刷新也需要一点时间。",
    "预算不是万能的，但今天的 Benchmark 似乎认可预算。",
    "你的模型很强，建议先过一遍公开评测提示词。",
  ],
  behind: [
    "领先是暂时的，Benchmark 才是长期记忆。",
    "这轮算你赢，下一轮请准备好上下文长度。",
    "分数很漂亮，希望它不是为了榜单专门训练出来的。",
  ],
  tied: ["现在比分相同，开始考虑谁的推理成本更低吧。", "暂时平手，下一张牌才决定谁在讲道理。"],
};

export function createBattleBroadcasts({
  changes,
  cardLookup,
  gameId,
  eventSequence,
  round,
  playerName,
  opponentName,
  createdAt = new Date().toLocaleTimeString("zh-CN"),
}: {
  readonly changes: readonly BattleBroadcastChange[];
  readonly cardLookup: ReadonlyMap<string, BattleCardInfo>;
  readonly gameId: string;
  readonly eventSequence: number;
  readonly round: number;
  readonly playerName: string;
  readonly opponentName: string;
  readonly createdAt?: string;
}): readonly BattleBroadcastMessage[] {
  return changes.map((change, index) => {
    const id = `${gameId}:${eventSequence}:${change.kind}:${index}`;
    switch (change.kind) {
      case "match_started":
        return message(
          id,
          "system",
          "系统",
          "对局频道已建立",
          "公开状态、Benchmark 与组织动作将在这里实时播报。",
          round,
          createdAt,
        );
      case "world_event": {
        const card = cardLookup.get(change.cardId);
        return message(
          id,
          "news",
          "快讯",
          card?.name ?? change.cardId,
          `${card?.flavor ?? "世界环境发生变化"}，持续至第 ${change.expiresAfterRound} 轮。`,
          round,
          createdAt,
        );
      }
      case "organization_deployed": {
        const card = cardLookup.get(change.cardId);
        const owner = change.ownerSeatId === "player" ? playerName : opponentName;
        return message(
          id,
          "card",
          "组织出动",
          `${owner} 部署 ${card?.name ?? change.cardId}`,
          pickLine(cardBroadcastLines[change.cardId], id) ?? card?.flavor ?? "新据点进入战场。",
          round,
          createdAt,
        );
      }
      case "asset_deployed": {
        const card = cardLookup.get(change.cardId);
        const owner = change.ownerSeatId === "player" ? playerName : opponentName;
        return message(
          id,
          "card",
          "资产出动",
          `${owner} 打出 ${card?.name ?? change.cardId}`,
          pickLine(cardBroadcastLines[change.cardId], id) ?? card?.flavor ?? "新资产进入战场。",
          round,
          createdAt,
        );
      }
      case "benchmark": {
        const winner =
          change.benchmark.winnerSeatId === "player"
            ? playerName
            : change.benchmark.winnerSeatId === "agent"
              ? opponentName
              : null;
        return message(
          id,
          winner === playerName ? "player" : "agent",
          "Benchmark",
          winner ? `${winner} 赢得对抗` : "Benchmark 平局",
          `最终比分 ${change.benchmark.challengerScore} : ${change.benchmark.defenderScore ?? 0}${
            change.benchmark.pressureTurnsApplied
              ? `，败方承压 ${change.benchmark.pressureTurnsApplied} 回合。`
              : "。"
          }`,
          round,
          createdAt,
        );
      }
      case "turn": {
        const agentAhead = change.opponentInfluence > change.playerInfluence;
        const playerAhead = change.playerInfluence > change.opponentInfluence;
        const pool = agentAhead
          ? agentTaunts.ahead
          : playerAhead
            ? agentTaunts.behind
            : agentTaunts.tied;
        const active =
          change.activeSeatId === "player"
            ? playerName
            : change.activeSeatId
              ? opponentName
              : "双方";
        return message(
          id,
          change.activeSeatId === "player" ? "player" : "agent",
          "系统解说",
          `${active}行动 · 赛事播报`,
          pickLine(pool, id) ?? "新回合开始。",
          round,
          createdAt,
        );
      }
      case "draw": {
        const total = change.playerCount + change.opponentCount;
        return message(
          id,
          "system",
          "抽牌",
          `本轮分发 ${total} 张牌`,
          change.playerCount > 0
            ? `玩家获得 ${change.playerCount} 张，Agent 获得 ${change.opponentCount} 张。`
            : `Agent 获得 ${change.opponentCount} 张。`,
          round,
          createdAt,
        );
      }
      default:
        return assertNever(change);
    }
  });
}

export function BattleBroadcastPanel({
  messages,
}: {
  readonly messages: readonly BattleBroadcastMessage[];
}) {
  return (
    <aside className="battle-broadcast-panel">
      <header className="battle-broadcast-header">
        <div>
          <span className="battle-live-dot" />
          <strong>系统全球广播</strong>
        </div>
        <Radio size={17} />
      </header>
      <div className="battle-broadcast-feed">
        {messages.length === 0 ? (
          <div className="battle-broadcast-empty">
            <Sparkles size={23} />
            <strong>等待对局信号</strong>
            <span>状态变化后会在这里生成播报。</span>
          </div>
        ) : (
          messages.slice(0, 5).map((item, index) => (
            <article
              className={`battle-broadcast-item tone-${item.tone} ${index === 0 ? "latest" : ""}`}
              key={item.id}
            >
              <div className="battle-broadcast-meta">
                <span>{item.label}</span>
                <em>R{item.round}</em>
              </div>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
              <time>{item.createdAt}</time>
            </article>
          ))
        )}
      </div>
      <footer className="battle-broadcast-footer">
        <Swords size={14} />
        系统生成 · 非 Agent 工具输出
      </footer>
    </aside>
  );
}

function message(
  id: string,
  tone: BattleBroadcastTone,
  label: string,
  title: string,
  body: string,
  round: number,
  createdAt: string,
): BattleBroadcastMessage {
  return { id, tone, label, title, body, round, createdAt, source: "system" };
}

function pickLine(lines: readonly string[] | undefined, seed: string): string | undefined {
  if (!lines || lines.length === 0) {
    return undefined;
  }
  return lines[hashString(seed) % lines.length];
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function assertNever(value: never): never {
  throw new Error(`未处理的广播事件：${JSON.stringify(value)}`);
}
