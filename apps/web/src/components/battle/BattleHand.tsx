/**
 * 战斗页底部手牌、选中详情、技术检定和结束回合控制。
 *
 * 作者：JucieOvo
 *
 * 手牌负责选择，操作面板负责执行合法行动。这样可以减少卡面按钮数量，让卡牌
 * 本体保持接近实体卡牌游戏的阅读方式。
 */

import type { LegalAction, ModelMayhemView } from "@modelmayhem/model-mayhem-rules";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Atom,
  BrainCircuit,
  Building2,
  Coins,
  Flag,
  Globe2,
  Layers3,
  Network,
  RefreshCw,
  Send,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import type { ContentResponse } from "../../api";
import { CardRuleSummary } from "./CardRuleSummary";
import { type BattleCardTheme, battleCardTheme, labelAbility, labelStatus } from "./labels";

type BattleCardInfo = ContentResponse["cards"][number];
type BattleAsset = ModelMayhemView["me"]["assets"][number];

export type BattleSelection =
  | {
      readonly kind: "hand";
      readonly handKind: "blueprint" | "action";
      readonly instanceId: string;
      readonly cardId: string;
    }
  | {
      readonly kind: "asset";
      readonly instanceId: string;
      readonly cardId: string;
    }
  | null;

export interface BattleDragState {
  readonly handKind: "blueprint" | "action";
  readonly instanceId: string;
  readonly cardId: string;
}

export function BattleHandDock({
  view,
  content,
  cardLookup,
  legalActions,
  selection,
  selectedMulligan,
  activeTab,
  submittingActionId,
  drawingInstanceIds = new Set<string>(),
  draggingInstanceId = null,
  onTabChange,
  onSelectMulligan,
  onSelect,
  onDragStart,
  onDragEnd,
  onPreview,
  onSubmit,
}: {
  readonly view: ModelMayhemView;
  readonly content: ContentResponse;
  readonly cardLookup: ReadonlyMap<string, BattleCardInfo>;
  readonly legalActions: readonly LegalAction[];
  readonly selection: BattleSelection;
  readonly selectedMulligan: readonly string[];
  readonly activeTab: "blueprint" | "action";
  readonly submittingActionId: string | null;
  readonly drawingInstanceIds?: ReadonlySet<string>;
  readonly draggingInstanceId?: string | null;
  readonly onTabChange: (tab: "blueprint" | "action") => void;
  readonly onSelectMulligan: (instanceId: string) => void;
  readonly onSelect: (selection: BattleSelection) => void;
  readonly onDragStart?: (selection: BattleDragState) => void;
  readonly onDragEnd?: () => void;
  readonly onPreview?: (selection: BattleSelection) => void;
  readonly onSubmit: (action: LegalAction) => Promise<void>;
}) {
  const mulliganAction = legalActions.find(
    (action) =>
      action.kind === "mulligan" &&
      action.cardInstanceIds.length === selectedMulligan.length &&
      action.cardInstanceIds.every((id) => selectedMulligan.includes(id)),
  );
  const endTurnAction = legalActions.find((action) => action.kind === "end_turn");
  const surrenderAction = legalActions.find((action) => action.kind === "surrender");
  const handCards =
    activeTab === "blueprint"
      ? view.me.blueprintHand.map((card) => ({
          instanceId: card.instanceId,
          cardId: card.cardId,
          handKind: "blueprint" as const,
        }))
      : view.me.actionHand.map((card) => ({
          instanceId: card.id,
          cardId: card.cardId,
          handKind: "action" as const,
        }));

  return (
    <section className="battle-hand-dock">
      <div className="battle-hand-tabs" role="tablist" aria-label="手牌类型">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "blueprint"}
          className={activeTab === "blueprint" ? "active" : ""}
          onClick={() => onTabChange("blueprint")}
        >
          <Layers3 size={14} />
          蓝图手牌
          <span>{view.me.blueprintHand.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "action"}
          className={activeTab === "action" ? "active" : ""}
          onClick={() => onTabChange("action")}
        >
          <Send size={14} />
          行动手牌
          <span>{view.me.actionHand.length}</span>
        </button>
      </div>

      <div className="battle-hand-stage">
        <BattleInspector
          view={view}
          content={content}
          cardLookup={cardLookup}
          legalActions={legalActions}
          selection={selection}
          submittingActionId={submittingActionId}
          onSelect={onSelect}
          onSubmit={onSubmit}
        />

        <div className="battle-hand-fan">
          {view.me.actionHandOverflow > 0 || view.me.blueprintHandOverflow > 0 ? (
            <div className="battle-discard-prompt" role="status">
              <strong>
                手牌超出：蓝图 {view.me.blueprintHandOverflow} · 行动 {view.me.actionHandOverflow}
              </strong>
              <span>可以先使用手牌，结束回合前分别降到上限以内</span>
            </div>
          ) : null}
          {handCards.length === 0 ? (
            <div className="battle-hand-empty">
              <BrainCircuit size={22} />
              <span>当前没有可使用的牌</span>
            </div>
          ) : null}
          {handCards.map((handCard, index) => {
            const card = cardLookup.get(handCard.cardId);
            const selected =
              selection?.kind === "hand" &&
              selection.instanceId === handCard.instanceId &&
              selection.handKind === handCard.handKind;
            const mulliganSelected =
              handCard.handKind === "blueprint" && selectedMulligan.includes(handCard.instanceId);
            const matchingActions = legalActions.filter((action) => {
              if (handCard.handKind === "blueprint") {
                return (
                  (action.kind === "deploy_organization" ||
                    action.kind === "deploy_asset" ||
                    action.kind === "discard_blueprint") &&
                  action.cardInstanceId === handCard.instanceId
                );
              }
              return (
                (action.kind === "play_action" || action.kind === "discard_action") &&
                action.actionInstanceId === handCard.instanceId
              );
            });
            const actionable =
              view.phase === "mulligan" ||
              matchingActions.some((action) => submittingActionId !== action.id);
            const drawing = drawingInstanceIds.has(handCard.instanceId);
            const dragging = draggingInstanceId === handCard.instanceId;
            return (
              <button
                type="button"
                className={[
                  "battle-hand-card",
                  `kind-${handCard.handKind}`,
                  selected ? "selected" : "",
                  mulliganSelected ? "mulligan-selected" : "",
                  actionable ? "actionable" : "inactive",
                  drawing ? "is-drawing" : "",
                  dragging ? "is-dragging" : "",
                ].join(" ")}
                style={{ "--card-index": index } as CSSProperties}
                key={`${handCard.handKind}-${handCard.instanceId}`}
                aria-pressed={selected || mulliganSelected}
                draggable={view.phase === "playing" && actionable}
                onDragStart={(event) => {
                  const dragState = {
                    handKind: handCard.handKind,
                    instanceId: handCard.instanceId,
                    cardId: handCard.cardId,
                  } satisfies BattleDragState;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", handCard.instanceId);
                  onSelect({
                    kind: "hand",
                    handKind: handCard.handKind,
                    instanceId: handCard.instanceId,
                    cardId: handCard.cardId,
                  });
                  onPreview?.(null);
                  onDragStart?.(dragState);
                }}
                onDragEnd={() => onDragEnd?.()}
                onMouseEnter={() =>
                  onPreview?.({
                    kind: "hand",
                    handKind: handCard.handKind,
                    instanceId: handCard.instanceId,
                    cardId: handCard.cardId,
                  })
                }
                onMouseLeave={() => onPreview?.(null)}
                onFocus={() =>
                  onPreview?.({
                    kind: "hand",
                    handKind: handCard.handKind,
                    instanceId: handCard.instanceId,
                    cardId: handCard.cardId,
                  })
                }
                onBlur={() => onPreview?.(null)}
                onClick={() => {
                  if (view.phase === "mulligan" && handCard.handKind === "blueprint") {
                    onSelectMulligan(handCard.instanceId);
                    return;
                  }
                  onSelect({
                    kind: "hand",
                    handKind: handCard.handKind,
                    instanceId: handCard.instanceId,
                    cardId: handCard.cardId,
                  });
                }}
              >
                <HandCardFace card={card} kind={handCard.handKind} />
              </button>
            );
          })}
        </div>

        <div className="battle-turn-control">
          {view.phase === "mulligan" ? (
            <button
              type="button"
              className="battle-mulligan-button"
              disabled={!mulliganAction || submittingActionId !== null}
              onClick={() => mulliganAction && void onSubmit(mulliganAction)}
            >
              <RefreshCw size={16} />
              {selectedMulligan.length === 0 ? "保留全部" : `弃置 ${selectedMulligan.length} 张`}
            </button>
          ) : null}
          {endTurnAction ? (
            <button
              type="button"
              className="battle-end-turn"
              disabled={submittingActionId !== null}
              onClick={() => void onSubmit(endTurnAction)}
            >
              <Flag size={18} />
              <span>结束回合</span>
            </button>
          ) : null}
          {surrenderAction ? (
            <button
              type="button"
              className="battle-surrender-button"
              disabled={submittingActionId !== null}
              onClick={() => void onSubmit(surrenderAction)}
            >
              投降
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function BattleCardZoom({
  selection,
  cardLookup,
  view,
}: {
  readonly selection: BattleSelection;
  readonly cardLookup: ReadonlyMap<string, BattleCardInfo>;
  readonly view: ModelMayhemView;
}) {
  const card = selection ? cardLookup.get(selection.cardId) : undefined;
  if (!selection || !card) {
    return null;
  }
  const theme = battleCardTheme(card);
  const ArtIcon = artIcon(theme);
  const asset =
    selection.kind === "asset"
      ? [...view.me.assets, ...view.opponent.assets].find(
          (candidate) => candidate.instanceId === selection.instanceId,
        )
      : undefined;
  return (
    <div className="battle-card-zoom-overlay" aria-hidden="true">
      <article className={`battle-card-zoom theme-${theme}`}>
        <div className="battle-card-zoom-art">
          <ArtIcon size={82} strokeWidth={1.25} />
          <span>{cardTypeLabel(card)}</span>
        </div>
        <div className="battle-card-zoom-title">
          <strong>{card.name}</strong>
          <span>
            {cardTypeLabel(card)} / {card.subtype}
          </span>
        </div>
        {card.type === "asset" && card.assetKind === "model" ? (
          <div className="battle-card-zoom-abilities">
            {Object.entries(card.abilities ?? {}).map(([ability, value]) => (
              <span key={ability}>
                {labelAbility(ability)} <b>{value}</b>
              </span>
            ))}
          </div>
        ) : null}
        {asset && asset.statuses.length > 0 ? (
          <div className="battle-card-zoom-statuses">
            {asset.statuses.map((status) => (
              <span key={status.id}>
                {labelStatus(status.id)} · {status.remainingTurns}
              </span>
            ))}
          </div>
        ) : null}
        <p>{card.flavor}</p>
        <CardRuleSummary card={card} cardLookup={cardLookup} compact />
        <div className="battle-card-zoom-cost">
          <span>
            <Zap size={14} /> {card.cost.compute}
          </span>
          <span>
            <Coins size={14} /> {card.cost.capital}
          </span>
        </div>
      </article>
    </div>
  );
}

function HandCardFace({
  card,
  kind,
}: {
  readonly card: BattleCardInfo | undefined;
  readonly kind: "blueprint" | "action";
}) {
  const theme = card ? battleCardTheme(card) : kind === "action" ? "action" : "model";
  const ArtIcon = artIcon(theme);
  return (
    <>
      <div className={`battle-hand-card-art ${kind} theme-${theme}`}>
        <div className="battle-hand-card-medallion">
          {card?.cost.compute ? <Zap size={12} /> : null}
          {card?.cost.capital ? <Coins size={12} /> : null}
          <strong>{card ? card.cost.compute || card.cost.capital : 0}</strong>
        </div>
        <ArtIcon size={30} />
        <span>{card?.subtype ?? kind}</span>
      </div>
      <div className="battle-hand-card-title">
        <strong>{card?.name ?? "未知卡片"}</strong>
        <span>{card ? cardTypeLabel(card) : kind === "action" ? "行动" : "蓝图"}</span>
      </div>
      <div className="battle-hand-card-cost">
        {card?.cost.compute ? (
          <span className="resource-compute">
            <Zap size={12} />
            {card.cost.compute}
          </span>
        ) : null}
        {card?.cost.capital ? (
          <span className="resource-capital">
            <Coins size={12} />
            {card.cost.capital}
          </span>
        ) : null}
      </div>
    </>
  );
}

function artIcon(theme: BattleCardTheme) {
  switch (theme) {
    case "model":
      return Atom;
    case "technology":
      return Network;
    case "organization":
      return Building2;
    case "world":
      return Globe2;
    case "action":
      return Send;
  }
}

function BattleInspector({
  view,
  content,
  cardLookup,
  legalActions,
  selection,
  submittingActionId,
  onSelect,
  onSubmit,
}: {
  readonly view: ModelMayhemView;
  readonly content: ContentResponse;
  readonly cardLookup: ReadonlyMap<string, BattleCardInfo>;
  readonly legalActions: readonly LegalAction[];
  readonly selection: BattleSelection;
  readonly submittingActionId: string | null;
  readonly onSelect: (selection: BattleSelection) => void;
  readonly onSubmit: (action: LegalAction) => Promise<void>;
}) {
  const selectedCard = selection ? cardLookup.get(selection.cardId) : undefined;
  const matchingActions = selection
    ? legalActions.filter((action) => {
        if (selection.kind === "asset") {
          return (
            action.kind === "set_benchmark_defender" &&
            action.modelInstanceId === selection.instanceId
          );
        }
        if (selection.handKind === "blueprint") {
          return (
            (action.kind === "deploy_organization" ||
              action.kind === "deploy_asset" ||
              action.kind === "discard_blueprint") &&
            action.cardInstanceId === selection.instanceId
          );
        }
        return (
          (action.kind === "play_action" || action.kind === "discard_action") &&
          action.actionInstanceId === selection.instanceId
        );
      })
    : [];
  const selectedAsset: BattleAsset | undefined =
    selection?.kind === "asset"
      ? [...view.me.assets, ...view.opponent.assets].find(
          (asset) => asset.instanceId === selection.instanceId,
        )
      : undefined;

  if (!selection || !selectedCard) {
    return (
      <aside className="battle-inspector empty">
        <div className="battle-inspector-mark">
          <Sparkles size={19} />
        </div>
        <strong>选择一张牌执行行动</strong>
        <p>悬浮卡牌查看完整效果</p>
      </aside>
    );
  }

  const cost = matchingActions.find((action) => action.preview)?.preview?.cost;
  const orderedActions = [...matchingActions].sort((left, right) => {
    const leftDiscard = left.kind === "discard_action" || left.kind === "discard_blueprint";
    const rightDiscard = right.kind === "discard_action" || right.kind === "discard_blueprint";
    return Number(leftDiscard) - Number(rightDiscard);
  });
  return (
    <aside className={`battle-inspector ${selection.kind}`}>
      <button
        type="button"
        className="battle-inspector-close"
        onClick={() => onSelect(null)}
        aria-label="关闭卡牌操作区"
      >
        <X size={14} />
      </button>
      <div className="battle-inspector-main">
        <div className="battle-inspector-heading">
          <div className="battle-inspector-title">
            <strong>{selectedCard.name}</strong>
            <span>
              {cardTypeLabel(selectedCard)} / {selectedCard.subtype}
            </span>
          </div>
        </div>
        {selectedCard.type === "asset" && selectedCard.assetKind === "model" ? (
          <div className="battle-inspector-abilities">
            {Object.entries(selectedCard.abilities ?? {}).map(([ability, value]) => (
              <span key={ability}>
                {labelAbility(ability)} <b>{value}</b>
              </span>
            ))}
          </div>
        ) : null}
        {selectedAsset ? (
          <div className="battle-inspector-statuses">
            {selectedAsset.statuses.length === 0 ? (
              <span>当前没有状态</span>
            ) : (
              selectedAsset.statuses.map((status) => (
                <span key={status.id}>
                  {labelStatus(status.id)} · {status.remainingTurns} 回合
                </span>
              ))
            )}
          </div>
        ) : null}
      </div>
      <div className="battle-inspector-side">
        <CostBreakdown cost={cost} />
        <div className="battle-inspector-actions">
          {orderedActions.length === 0 ? (
            <span className="battle-inspector-unavailable">
              {view.phase === "mulligan" ? "起手调度阶段" : "当前没有可执行行动"}
            </span>
          ) : (
            orderedActions.map((action) => {
              const discard =
                action.kind === "discard_action" || action.kind === "discard_blueprint";
              return (
                <button
                  type="button"
                  key={action.id}
                  className={`battle-inspector-action${discard ? " discard" : " primary"}`}
                  disabled={submittingActionId !== null}
                  onClick={() => void onSubmit(action)}
                >
                  {discard ? <X size={14} /> : <Send size={14} />}
                  {submittingActionId === action.id ? "提交中" : action.label}
                </button>
              );
            })
          )}
        </div>
        <div className="battle-inspector-foot">
          影响力空间 {view.me.influenceGainRemaining} · 资产 {content.balance.assetDeploysPerTurn}{" "}
          次
        </div>
      </div>
    </aside>
  );
}

function CostBreakdown({
  cost,
}: {
  readonly cost:
    | {
        readonly compute: number;
        readonly capital: number;
        readonly adjustments: readonly {
          readonly source: string;
          readonly resource: string;
          readonly amount: number;
          readonly kind: string;
        }[];
      }
    | undefined;
}) {
  if (!cost) {
    return null;
  }
  return (
    <div className="battle-cost-breakdown">
      <div>
        <span>最终费用</span>
        <strong>
          <Zap size={12} /> {cost.compute}
          <Coins size={12} /> {cost.capital}
        </strong>
      </div>
      {cost.adjustments.length === 0 ? (
        <span>没有费用修正</span>
      ) : (
        cost.adjustments.map((adjustment) => (
          <span
            key={`${adjustment.source}-${adjustment.resource}-${adjustment.kind}-${adjustment.amount}`}
          >
            {adjustment.source} {adjustment.resource} {adjustment.amount > 0 ? "+" : ""}
            {adjustment.amount}
          </span>
        ))
      )}
    </div>
  );
}

export function BattleTechCheckDialog({
  question,
  legalActions,
  secondsTotal,
  submittingActionId,
  onSubmit,
}: {
  readonly question: {
    readonly prompt: string;
    readonly options: readonly { readonly id: string; readonly text: string }[];
  } | null;
  readonly legalActions: readonly LegalAction[];
  readonly secondsTotal: number;
  readonly submittingActionId: string | null;
  readonly onSubmit: (action: LegalAction) => Promise<void>;
}) {
  const [secondsLeft, setSecondsLeft] = useState(secondsTotal);
  useEffect(() => {
    if (!question) {
      return;
    }
    setSecondsLeft(secondsTotal);
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [question, secondsTotal]);

  return (
    <Dialog.Root open={question !== null}>
      <Dialog.Portal>
        <Dialog.Overlay className="battle-dialog-overlay" />
        <Dialog.Content
          className="battle-tech-dialog"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title>技术检定</Dialog.Title>
          <Dialog.Description>{question?.prompt}</Dialog.Description>
          <div
            className="battle-tech-timer"
            role="progressbar"
            aria-label={`剩余 ${secondsLeft} 秒`}
            aria-valuemin={0}
            aria-valuemax={secondsTotal}
            aria-valuenow={secondsLeft}
          >
            <span style={{ width: `${(secondsLeft / secondsTotal) * 100}%` }} />
          </div>
          <div className="battle-tech-options">
            {question?.options.map((option) => {
              const action = legalActions.find(
                (candidate) =>
                  candidate.kind === "resolve_tech_check" && candidate.optionId === option.id,
              );
              return (
                <button
                  type="button"
                  key={option.id}
                  disabled={!action || submittingActionId !== null}
                  onClick={() => action && void onSubmit(action)}
                >
                  <span>{option.text}</span>
                  <Send size={14} />
                </button>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function cardTypeLabel(card: BattleCardInfo): string {
  if (card.type === "organization") {
    return card.subtype === "company" ? "组织" : "据点";
  }
  if (card.type === "asset") {
    return card.assetKind === "model" ? "模型" : "技术";
  }
  if (card.type === "action") {
    return "行动";
  }
  return "世界事件";
}
