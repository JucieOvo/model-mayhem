/**
 * 战斗页顶部身份栏、中央竞技场和回合反馈。
 *
 * 作者：JucieOvo
 *
 * 所有数值均来自服务端公开视图。组件只负责把这些数值组织成接近实体卡牌桌面
 * 的信息层级和反馈效果。
 */

import type { BenchmarkResult, ModelMayhemView } from "@modelmayhem/model-mayhem-rules";
import {
  Activity,
  Bot,
  BrainCircuit,
  Coins,
  Cpu,
  Layers3,
  Sparkles,
  UserRound,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ContentResponse } from "../../api";
import { formatSignedValue, labelAbility, labelActionSubtype, labelStatus } from "./labels";

type BattleCardInfo = ContentResponse["cards"][number];
type PublicPlayerView = ModelMayhemView["opponent"];

export interface BattleChromeFeedback {
  readonly benchmarkPulse: number;
  readonly worldEventPulse: number;
  readonly turnPulse: number;
  readonly influencePlayer: number;
  readonly influenceAgent: number;
}

export function BattleHeader({
  view,
  influenceTarget,
  agentRunning,
  agentElapsedMs,
  feedback,
  drawingSeatId = null,
}: {
  readonly view: ModelMayhemView;
  readonly influenceTarget: number;
  readonly agentRunning: boolean;
  readonly agentElapsedMs: number | null;
  readonly feedback: BattleChromeFeedback;
  readonly drawingSeatId?: string | null;
}) {
  const playerTurn = view.activeSeatId === view.viewerSeatId;
  return (
    <header
      className={[
        "battle-header",
        playerTurn ? "player-turn" : "agent-turn",
        drawingSeatId ? "draw-active" : "",
      ].join(" ")}
    >
      <PlayerSeat
        player={view.opponent}
        side="agent"
        influenceTarget={influenceTarget}
        influenceDelta={feedback.influenceAgent}
        active={view.activeSeatId === view.opponent.seatId}
        drawing={drawingSeatId === view.opponent.seatId}
        agentRunning={agentRunning}
        agentElapsedMs={agentElapsedMs}
      />

      <div className="battle-round-core" aria-live="polite">
        <span className="battle-round-eyebrow">第 {view.round} 轮</span>
        <strong>{playerTurn ? "你的行动阶段" : "对手行动阶段"}</strong>
        <div className="battle-round-track" aria-hidden="true">
          <span className="battle-round-track-fill" />
        </div>
      </div>

      <PlayerSeat
        player={view.me}
        side="player"
        influenceTarget={influenceTarget}
        influenceDelta={feedback.influencePlayer}
        active={playerTurn}
        drawing={drawingSeatId === view.viewerSeatId}
      />
    </header>
  );
}

function PlayerSeat({
  player,
  side,
  influenceTarget,
  influenceDelta,
  active,
  drawing = false,
  agentRunning = false,
  agentElapsedMs = null,
}: {
  readonly player: PublicPlayerView;
  readonly side: "agent" | "player";
  readonly influenceTarget: number;
  readonly influenceDelta: number;
  readonly active: boolean;
  readonly drawing?: boolean;
  readonly agentRunning?: boolean;
  readonly agentElapsedMs?: number | null;
}) {
  const portrait = side === "agent" ? <Bot size={27} /> : <UserRound size={27} />;
  return (
    <section
      className={[
        "battle-seat-panel",
        side,
        active ? "active" : "",
        drawing ? "draw-source" : "",
      ].join(" ")}
    >
      <InfluenceDial
        value={player.influence}
        target={influenceTarget}
        label={`${player.displayName}影响力`}
      />
      <div className="battle-seat-identity">
        <div className="battle-seat-name-line">
          <span className="battle-seat-portrait">{portrait}</span>
          <div>
            <strong>{player.displayName}</strong>
            <span>{player.doctrineId}</span>
          </div>
        </div>
        <div className="battle-seat-resources">
          <ResourcePill
            icon={<Coins size={13} />}
            label="资本"
            value={`${player.capital} (+${player.capitalIncome})`}
            tone="capital"
          />
          <ResourcePill
            icon={<Zap size={13} />}
            label="算力"
            value={`${player.compute}/${player.nextComputeCeiling}`}
            tone="compute"
          />
          <ResourcePill
            icon={<Layers3 size={13} />}
            label="手牌"
            value={`${player.blueprintHandCount} / ${player.actionHandCount}`}
            tone="muted"
          />
          <ResourcePill
            icon={<Layers3 size={13} />}
            label="牌库"
            value={String(player.blueprintDeckCount)}
            tone="muted"
            deck={true}
          />
        </div>
      </div>
      {influenceDelta !== 0 ? (
        <span
          key={influenceDelta + player.influence}
          className={`battle-influence-float ${influenceDelta > 0 ? "positive" : "negative"}`}
        >
          {formatSignedValue(influenceDelta)}
        </span>
      ) : null}
      {side === "agent" && agentRunning ? (
        <div className="battle-agent-thinking">
          <span className="battle-thinking-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>思考中 {formatElapsed(agentElapsedMs)}</span>
        </div>
      ) : null}
    </section>
  );
}

function InfluenceDial({
  value,
  target,
  label,
}: {
  readonly value: number;
  readonly target: number;
  readonly label: string;
}) {
  const percentage = Math.min(1, target > 0 ? value / target : 0);
  const radius = 29;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percentage);
  return (
    <div className="battle-influence-dial" role="img" aria-label={`${label} ${value}/${target}`}>
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle className="battle-dial-track" cx="36" cy="36" r={radius} />
        <circle
          className="battle-dial-value"
          cx="36"
          cy="36"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div>
        <strong>{value}</strong>
        <span>/ {target}</span>
      </div>
    </div>
  );
}

function ResourcePill({
  icon,
  label,
  value,
  tone,
  deck = false,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly tone: "capital" | "compute" | "muted";
  readonly deck?: boolean;
}) {
  return (
    <span
      className={[
        "battle-resource",
        `battle-resource-${tone}`,
        deck ? "battle-resource-deck" : "",
      ].join(" ")}
      title={label}
    >
      {icon}
      <span>{value}</span>
    </span>
  );
}

export function BattleArena({
  view,
  content,
  cardLookup,
  feedback,
}: {
  readonly view: ModelMayhemView;
  readonly content: ContentResponse;
  readonly cardLookup: ReadonlyMap<string, BattleCardInfo>;
  readonly feedback: BattleChromeFeedback;
}) {
  const worldEvent = view.worldEvent ? cardLookup.get(view.worldEvent.cardId) : undefined;
  const benchmark = view.lastBenchmark;
  const assetCardIds = new Map(
    [...view.me.assets, ...view.opponent.assets].map((asset) => [asset.instanceId, asset.cardId]),
  );
  return (
    <section className="battle-arena">
      <div
        key={`world-${feedback.worldEventPulse}`}
        className={`battle-world-ribbon ${feedback.worldEventPulse > 0 ? "event-pulse" : ""}`}
      >
        <span className="battle-world-ribbon-label">
          <Sparkles size={14} />
          世界事件
        </span>
        <strong>{worldEvent?.name ?? "无"}</strong>
        <p>{worldEvent?.flavor ?? "当前没有环境修正"}</p>
        <em>
          {view.worldEvent
            ? `持续至第 ${view.worldEvent.expiresAfterRound} 轮`
            : "等待下一项环境变化"}
        </em>
      </div>

      <div className="battle-arena-core">
        <BenchmarkArena
          key={`benchmark-${feedback.benchmarkPulse}`}
          benchmark={benchmark}
          cardLookup={cardLookup}
          assetCardIds={assetCardIds}
          viewerSeatId={view.viewerSeatId}
          opponentName={view.opponent.displayName}
          pulse={feedback.benchmarkPulse > 0}
          pending={view.pendingTechCheck !== null}
        />

        <div className="battle-turn-budget">
          <div className="battle-arena-label">
            <Activity size={14} />
            本回合
          </div>
          <BudgetLine
            label="影响力空间"
            value={String(view.me.influenceGainRemaining)}
            tone="influence"
          />
          <BudgetLine
            label="组织"
            value={`${view.me.organizationDeploysThisTurn}/${content.balance.organizationDeploysPerTurn}`}
            tone="capital"
          />
          <BudgetLine
            label="资产"
            value={`${view.me.assetDeploysThisTurn}/${content.balance.assetDeploysPerTurn}`}
            tone="compute"
          />
          <BudgetLine
            label="Benchmark"
            value={`${view.me.benchmarksThisTurn}/${content.balance.benchmarksPerTurn}`}
            tone="muted"
          />
        </div>
      </div>
    </section>
  );
}

function BenchmarkArena({
  benchmark,
  cardLookup,
  assetCardIds,
  viewerSeatId,
  opponentName,
  pulse,
  pending,
}: {
  readonly benchmark: BenchmarkResult | null;
  readonly cardLookup: ReadonlyMap<string, BattleCardInfo>;
  readonly assetCardIds: ReadonlyMap<string, string>;
  readonly viewerSeatId: string;
  readonly opponentName: string;
  readonly pulse: boolean;
  readonly pending: boolean;
}) {
  if (!benchmark) {
    return (
      <div className="battle-benchmark-arena empty">
        <div className="battle-arena-label">
          <BrainCircuit size={14} />
          Benchmark 竞技场
        </div>
        <strong>等待首次挑战</strong>
        <span>模型入场并打出 Benchmark 行动后，这里会展示完整结算。</span>
      </div>
    );
  }
  const challengerName =
    cardLookup.get(
      assetCardIds.get(benchmark.challengerModelInstanceId) ?? benchmark.challengerModelInstanceId,
    )?.name ?? benchmark.challengerModelInstanceId;
  const defenderName = benchmark.defenderModelInstanceId
    ? (cardLookup.get(
        assetCardIds.get(benchmark.defenderModelInstanceId) ?? benchmark.defenderModelInstanceId,
      )?.name ?? benchmark.defenderModelInstanceId)
    : "无守擂模型";
  const challengerWon = benchmark.winnerSeatId === benchmark.challengerSeatId;
  const defenderWon = benchmark.winnerSeatId === benchmark.defenderSeatId;
  const seatName = (seatId: string): string => (seatId === viewerSeatId ? "玩家" : opponentName);
  return (
    <div className={`battle-benchmark-arena ${pulse ? "benchmark-pulse" : ""}`}>
      <div className="battle-arena-label">
        <BrainCircuit size={14} />
        {labelAbility(benchmark.ability)} Benchmark
      </div>
      <div className="battle-versus-grid">
        <BenchmarkSide
          modelName={challengerName}
          seatName={seatName(benchmark.challengerSeatId)}
          score={benchmark.challengerScore}
          modifiers={benchmark.challengerModifiers}
          winner={challengerWon}
        />
        <div className="battle-versus-mark">
          <span>VS</span>
          <strong>
            {benchmark.scoreDifference === null
              ? benchmark.tied
                ? "平局"
                : "已结算"
              : `分差 ${benchmark.scoreDifference}`}
          </strong>
        </div>
        <BenchmarkSide
          modelName={defenderName}
          seatName={seatName(benchmark.defenderSeatId)}
          score={benchmark.defenderScore}
          modifiers={benchmark.defenderModifiers}
          winner={defenderWon}
        />
      </div>
      <div className="battle-benchmark-result">
        <span>
          {benchmark.winnerSeatId
            ? `${seatName(benchmark.winnerSeatId)}赢得本次对抗`
            : "双方均未取得优势"}
        </span>
        {benchmark.pressureTurnsApplied ? (
          <strong>
            {labelStatus("pressure")} {benchmark.pressureTurnsApplied} 回合
          </strong>
        ) : null}
        {pending ? <em>技术检定中</em> : null}
      </div>
    </div>
  );
}

function BenchmarkSide({
  modelName,
  seatName,
  score,
  modifiers,
  winner,
}: {
  readonly modelName: string;
  readonly seatName: string;
  readonly score: number | null;
  readonly modifiers: readonly { readonly source: string; readonly amount: number }[];
  readonly winner: boolean;
}) {
  return (
    <div className={`battle-benchmark-side ${winner ? "winner" : ""}`}>
      <span>{seatName}</span>
      <strong title={modelName}>{modelName}</strong>
      <b>{score}</b>
      <div className="battle-modifier-list">
        {modifiers.length === 0 ? <em>无修正</em> : null}
        {modifiers.map((modifier) => (
          <span key={`${modifier.source}-${modifier.amount}`}>
            {modifier.source} {formatSignedValue(modifier.amount)}
          </span>
        ))}
      </div>
    </div>
  );
}

function BudgetLine({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone: "influence" | "capital" | "compute" | "muted";
}) {
  return (
    <div className="battle-budget-line">
      <span>{label}</span>
      <strong className={`battle-resource-${tone}`}>{value}</strong>
    </div>
  );
}

export function BattleActionPool({ view }: { readonly view: ModelMayhemView }) {
  return (
    <div className="battle-action-pool">
      <span className="battle-action-pool-label">
        <Cpu size={13} />
        行动池
      </span>
      {view.actionPoolComposition.map((entry) => (
        <span className="battle-pool-chip" key={entry.subtype}>
          {labelActionSubtype(entry.subtype)} <strong>{entry.count}</strong>
        </span>
      ))}
    </div>
  );
}

export function BattleTurnBanner({
  pulse,
  round,
  activeSeatId,
  viewerSeatId,
  opponentName,
}: {
  readonly pulse: number;
  readonly round: number;
  readonly activeSeatId: string | null;
  readonly viewerSeatId: string;
  readonly opponentName: string;
}) {
  if (pulse === 0 || activeSeatId === null) {
    return null;
  }
  const playerTurn = activeSeatId === viewerSeatId;
  return (
    <div className={`battle-turn-banner ${playerTurn ? "player" : "agent"}`} key={pulse}>
      <span>第 {round} 轮</span>
      <strong>{playerTurn ? "你的回合" : `${opponentName} 回合`}</strong>
    </div>
  );
}

export function BattleWorldEventAnnouncement({
  pulse,
  name,
  flavor,
  expiresAfterRound,
}: {
  readonly pulse: number;
  readonly name: string;
  readonly flavor: string;
  readonly expiresAfterRound: number;
}) {
  if (pulse === 0) {
    return null;
  }
  return (
    <div className="battle-world-announcement" key={pulse}>
      <span>世界事件</span>
      <strong>{name}</strong>
      <p>{flavor}</p>
      <em>持续至第 {expiresAfterRound} 轮</em>
    </div>
  );
}

function formatElapsed(value: number | null): string {
  if (value === null) {
    return "0:00";
  }
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}
