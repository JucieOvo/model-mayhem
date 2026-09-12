/**
 * 对局抽牌阶段和随机分发动效。
 *
 * 作者：JucieOvo
 *
 * 动画只使用服务端已经返回的新手牌实例。玩家牌揭示真实牌面，对手只展示牌背和
 * 数量，不读取隐藏手牌。
 */

import { Layers3, Shuffle, Sparkles } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import type { ContentResponse } from "../../api";

type BattleCardInfo = ContentResponse["cards"][number];

export interface BattleDrawBatch {
  readonly id: number;
  readonly kind: "mulligan" | "turn";
  readonly round: number;
  readonly activeSeatId: string;
  readonly playerBlueprintCards: readonly {
    readonly instanceId: string;
    readonly cardId: string;
  }[];
  readonly playerActionCards: readonly {
    readonly instanceId: string;
    readonly cardId: string;
  }[];
  readonly opponentBlueprintCount: number;
  readonly opponentActionCount: number;
}

export function BattleDrawOverlay({
  batch,
  cardLookup,
  playerName,
  opponentName,
}: {
  readonly batch: BattleDrawBatch | null;
  readonly cardLookup: ReadonlyMap<string, BattleCardInfo>;
  readonly playerName: string;
  readonly opponentName: string;
}) {
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const update = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  if (!batch) {
    return null;
  }
  const playerCards = [
    ...batch.playerBlueprintCards.map((card) => ({ ...card, kind: "blueprint" as const })),
    ...batch.playerActionCards.map((card) => ({ ...card, kind: "action" as const })),
  ];
  const opponentCount = batch.opponentBlueprintCount + batch.opponentActionCount;
  const totalCount = playerCards.length + opponentCount;
  const opponentCardKeys = Array.from(
    { length: opponentCount },
    (_, index) => `opponent-${batch.id}-${index}`,
  );
  if (totalCount === 0) {
    return null;
  }
  const activeName = batch.activeSeatId === "player" ? playerName : opponentName;

  return (
    <section className="battle-draw-overlay" aria-live="polite">
      <div className="battle-draw-phase">
        <span className="battle-draw-phase-icon">
          <Shuffle size={17} />
        </span>
        <div>
          <small>{batch.kind === "mulligan" ? "调度重抽" : `第 ${batch.round} 轮`}</small>
          <strong>
            {batch.kind === "mulligan" ? "重新抽取起始手牌" : `${activeName}抽牌阶段`}
          </strong>
        </div>
        <em>随机抽取并分发 {totalCount} 张</em>
      </div>

      <div className="battle-draw-center" aria-hidden="true">
        <span className="battle-draw-deck-stack">
          <i />
          <i />
          <i />
          <Layers3 size={20} />
        </span>
        <span className="battle-draw-beam" />
        <span className="battle-draw-spark">
          <Sparkles size={18} />
        </span>
      </div>

      {playerCards.map((card, index) => (
        <DrawFlightCard
          key={`player-${card.kind}-${card.instanceId}`}
          side="player"
          index={index}
          count={playerCards.length}
          viewport={viewport}
          card={cardLookup.get(card.cardId)}
        />
      ))}
      {opponentCardKeys.map((key, index) => (
        <DrawFlightCard
          key={key}
          side="opponent"
          index={index}
          count={opponentCount}
          viewport={viewport}
          card={undefined}
        />
      ))}
    </section>
  );
}

function DrawFlightCard({
  side,
  index,
  count,
  viewport,
  card,
}: {
  readonly side: "player" | "opponent";
  readonly index: number;
  readonly count: number;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly card: BattleCardInfo | undefined;
}) {
  const spread = Math.min(52, 260 / Math.max(count, 1));
  const centeredIndex = index - (count - 1) / 2;
  const startX = side === "player" ? viewport.width - 62 : 62;
  const startY = side === "player" ? viewport.height - 72 : 72;
  const endX = viewport.width / 2 + centeredIndex * spread;
  const endY = side === "player" ? viewport.height - 176 : 92;
  const style = {
    "--draw-start-x": `${startX}px`,
    "--draw-start-y": `${startY}px`,
    "--draw-end-x": `${endX}px`,
    "--draw-end-y": `${endY}px`,
    "--draw-delay": `${index * 105}ms`,
    "--draw-rotation": `${side === "player" ? 8 : -8}deg`,
  } as CSSProperties;

  return (
    <div className={`battle-draw-flight ${side}`} style={style}>
      {side === "player" && card ? (
        <div className={`battle-draw-face ${card.assetKind === "model" ? "model" : "technology"}`}>
          <span>{card.type === "organization" ? "组织" : (card.assetKind ?? card.subtype)}</span>
          <strong>{card.name}</strong>
          <small>{card.subtype}</small>
        </div>
      ) : (
        <div className="battle-draw-back">
          <Layers3 size={22} />
        </div>
      )}
    </div>
  );
}
