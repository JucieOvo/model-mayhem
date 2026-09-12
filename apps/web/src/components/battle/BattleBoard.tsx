/**
 * 双方据点与模型战场。
 *
 * 作者：JucieOvo
 *
 * 组织据点作为承载卡槽，模型与技术直接堆叠在据点内。组件接收真实服务和视图
 * 产生的瞬时类名，用于播放部署、状态变化和守擂切换反馈。
 */

import type { LegalAction, ModelMayhemView } from "@modelmayhem/model-mayhem-rules";
import { Activity, Cpu, ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { ContentResponse } from "../../api";
import type { BattleDragState, BattleSelection } from "./BattleHand";
import { labelAbility, labelStatus } from "./labels";

type BattleCardInfo = ContentResponse["cards"][number];
type BattleAnchor = ModelMayhemView["me"]["anchors"][number];
type BattleAsset = ModelMayhemView["me"]["assets"][number];

export interface BattleBoardFeedback {
  readonly deployedAssetIds: ReadonlySet<string>;
  readonly changedAssetIds: ReadonlySet<string>;
}

export function BattleBoard({
  view,
  cardLookup,
  slotCount,
  interactive,
  feedback,
  selectedAssetId,
  onSelectAsset,
  defenderActions,
  legalActions,
  draggedHand,
  onSubmit,
  submittingActionId,
  onPreview,
  arena,
}: {
  readonly view: ModelMayhemView;
  readonly cardLookup: ReadonlyMap<string, BattleCardInfo>;
  readonly slotCount: number;
  readonly interactive: boolean;
  readonly feedback: BattleBoardFeedback;
  readonly selectedAssetId: string | null;
  readonly onSelectAsset: (
    selection: { readonly instanceId: string; readonly cardId: string } | null,
  ) => void;
  readonly defenderActions: readonly LegalAction[];
  readonly legalActions: readonly LegalAction[];
  readonly draggedHand: BattleDragState | null;
  readonly onSubmit: (action: LegalAction) => Promise<void>;
  readonly submittingActionId: string | null;
  readonly onPreview: (selection: BattleSelection) => void;
  readonly arena: ReactNode;
}) {
  return (
    <section className="battle-board">
      <BattleLane
        lane="opponent"
        title={view.opponent.displayName}
        anchors={view.opponent.anchors}
        assets={view.opponent.assets}
        cardLookup={cardLookup}
        slotCount={slotCount}
        interactive={false}
        feedback={feedback}
        selectedAssetId={selectedAssetId}
        onSelectAsset={onSelectAsset}
        defenderActions={[]}
        legalActions={legalActions}
        draggedHand={draggedHand}
        onSubmit={onSubmit}
        submittingActionId={submittingActionId}
        defenderModelInstanceId={view.opponent.benchmarkDefenderModelInstanceId}
        onPreview={onPreview}
      />
      <div className="battle-board-arena">{arena}</div>
      <BattleLane
        lane="player"
        title={view.me.displayName}
        anchors={view.me.anchors}
        assets={view.me.assets}
        cardLookup={cardLookup}
        slotCount={slotCount}
        interactive={interactive}
        feedback={feedback}
        selectedAssetId={selectedAssetId}
        onSelectAsset={onSelectAsset}
        defenderActions={defenderActions}
        legalActions={legalActions}
        draggedHand={draggedHand}
        onSubmit={onSubmit}
        submittingActionId={submittingActionId}
        defenderModelInstanceId={view.me.benchmarkDefenderModelInstanceId}
        onPreview={onPreview}
      />
    </section>
  );
}

function BattleLane({
  lane,
  title,
  anchors,
  assets,
  cardLookup,
  slotCount,
  interactive,
  feedback,
  selectedAssetId,
  onSelectAsset,
  defenderActions,
  legalActions,
  draggedHand,
  onSubmit,
  submittingActionId,
  defenderModelInstanceId,
  onPreview,
}: {
  readonly lane: "opponent" | "player";
  readonly title: string;
  readonly anchors: readonly BattleAnchor[];
  readonly assets: readonly BattleAsset[];
  readonly cardLookup: ReadonlyMap<string, BattleCardInfo>;
  readonly slotCount: number;
  readonly interactive: boolean;
  readonly feedback: BattleBoardFeedback;
  readonly selectedAssetId: string | null;
  readonly onSelectAsset: (
    selection: { readonly instanceId: string; readonly cardId: string } | null,
  ) => void;
  readonly defenderActions: readonly LegalAction[];
  readonly legalActions: readonly LegalAction[];
  readonly draggedHand: BattleDragState | null;
  readonly onSubmit: (action: LegalAction) => Promise<void>;
  readonly submittingActionId: string | null;
  readonly defenderModelInstanceId: string | null;
  readonly onPreview: (selection: BattleSelection) => void;
}) {
  const homeLab = anchors.find((anchor) => anchor.isHomeLab);
  const organizationSlots = Array.from({ length: slotCount }, (_, slotIndex) => ({
    slotIndex,
    anchor: anchors.find((anchor) => !anchor.isHomeLab && anchor.slotIndex === slotIndex),
  }));
  return (
    <section className={`battle-lane ${lane}`}>
      <div className="battle-lane-heading">
        <span>{title} 战场</span>
        <strong>{assets.length} 张公开牌</strong>
      </div>
      <div className="battle-anchor-grid">
        <AnchorCard
          anchor={homeLab}
          label="主实验室"
          assets={assets}
          cardLookup={cardLookup}
          interactive={interactive}
          feedback={feedback}
          selectedAssetId={selectedAssetId}
          onSelectAsset={onSelectAsset}
          defenderActions={defenderActions}
          legalActions={legalActions}
          draggedHand={draggedHand}
          onSubmit={onSubmit}
          submittingActionId={submittingActionId}
          defenderModelInstanceId={defenderModelInstanceId}
          onPreview={onPreview}
        />
        {organizationSlots.map(({ anchor, slotIndex }) => (
          <AnchorCard
            key={anchor?.id ?? `${lane}-empty-${slotIndex}`}
            anchor={anchor}
            label={`据点槽位 ${slotIndex + 1}`}
            assets={assets}
            cardLookup={cardLookup}
            interactive={interactive}
            feedback={feedback}
            selectedAssetId={selectedAssetId}
            onSelectAsset={onSelectAsset}
            defenderActions={defenderActions}
            legalActions={legalActions}
            draggedHand={draggedHand}
            onSubmit={onSubmit}
            submittingActionId={submittingActionId}
            defenderModelInstanceId={defenderModelInstanceId}
            onPreview={onPreview}
          />
        ))}
      </div>
    </section>
  );
}

function AnchorCard({
  anchor,
  label,
  assets,
  cardLookup,
  interactive,
  feedback,
  selectedAssetId,
  onSelectAsset,
  defenderActions,
  legalActions,
  draggedHand,
  onSubmit,
  submittingActionId,
  defenderModelInstanceId,
  onPreview,
}: {
  readonly anchor: BattleAnchor | undefined;
  readonly label: string;
  readonly assets: readonly BattleAsset[];
  readonly cardLookup: ReadonlyMap<string, BattleCardInfo>;
  readonly interactive: boolean;
  readonly feedback: BattleBoardFeedback;
  readonly selectedAssetId: string | null;
  readonly onSelectAsset: (
    selection: { readonly instanceId: string; readonly cardId: string } | null,
  ) => void;
  readonly defenderActions: readonly LegalAction[];
  readonly legalActions: readonly LegalAction[];
  readonly draggedHand: BattleDragState | null;
  readonly onSubmit: (action: LegalAction) => Promise<void>;
  readonly submittingActionId: string | null;
  readonly defenderModelInstanceId: string | null;
  readonly onPreview: (selection: BattleSelection) => void;
}) {
  if (!anchor) {
    return (
      <article className="battle-anchor empty" aria-label={label}>
        <span className="battle-empty-slot-mark" aria-hidden="true">
          <Sparkles size={18} />
        </span>
      </article>
    );
  }
  const anchorName =
    anchor.organizationCardId === null
      ? "主实验室"
      : (cardLookup.get(anchor.organizationCardId)?.name ?? anchor.organizationCardId);
  const anchorAssets = assets.filter((asset) => asset.anchorId === anchor.id);
  const models = anchorAssets.filter(
    (asset) => cardLookup.get(asset.cardId)?.assetKind === "model",
  );
  const technologies = anchorAssets.filter(
    (asset) => cardLookup.get(asset.cardId)?.assetKind !== "model",
  );
  const attachedTechnologyIds = new Set(
    technologies
      .map((asset) => asset.attachedModelInstanceId)
      .filter((value): value is string => value !== undefined),
  );
  const looseTechnologies = technologies.filter(
    (asset) =>
      !asset.attachedModelInstanceId ||
      !models.some((model) => model.instanceId === asset.attachedModelInstanceId),
  );
  const anchorDropAction = findDropAction(legalActions, draggedHand, anchor);

  return (
    <article
      className={[
        "battle-anchor",
        anchor.isHomeLab ? "home" : "organization",
        anchorDropAction ? "valid-drop-target" : "",
      ].join(" ")}
      onDragOver={(event) => {
        if (anchorDropAction) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(event) => {
        if (anchorDropAction) {
          event.preventDefault();
          void onSubmit(anchorDropAction);
        }
      }}
    >
      <div className="battle-anchor-heading">
        <div>
          <strong>{anchorName}</strong>
          <span>{anchor.isHomeLab ? "基础战区" : "组织据点"}</span>
        </div>
        <b>
          {anchorAssets.length}/{anchor.capacity}
        </b>
      </div>
      <div className="battle-unit-row">
        {models.map((asset) => {
          const card = cardLookup.get(asset.cardId);
          const attachedTechnologies = technologies.filter(
            (technology) => technology.attachedModelInstanceId === asset.instanceId,
          );
          const modelDropAction = findDropAction(
            legalActions,
            draggedHand,
            anchor,
            asset.instanceId,
          );
          return (
            <ModelUnit
              key={asset.instanceId}
              asset={asset}
              card={card}
              attachedTechnologies={attachedTechnologies.map((technology) => ({
                asset: technology,
                card: cardLookup.get(technology.cardId),
              }))}
              interactive={interactive}
              selected={selectedAssetId === asset.instanceId}
              isDefender={asset.instanceId === defenderModelInstanceId}
              recentlyDeployed={feedback.deployedAssetIds.has(asset.instanceId)}
              recentlyChanged={feedback.changedAssetIds.has(asset.instanceId)}
              dropAction={modelDropAction}
              onDrop={() => modelDropAction && void onSubmit(modelDropAction)}
              defenderAction={defenderActions.find(
                (action) =>
                  action.kind === "set_benchmark_defender" &&
                  (action.modelInstanceId === asset.instanceId ||
                    (action.modelInstanceId === null &&
                      asset.instanceId === defenderModelInstanceId)),
              )}
              onSelect={() => onSelectAsset({ instanceId: asset.instanceId, cardId: asset.cardId })}
              onPreview={() =>
                onPreview({ kind: "asset", instanceId: asset.instanceId, cardId: asset.cardId })
              }
              onPreviewEnd={() => onPreview(null)}
              onSubmit={onSubmit}
              submittingActionId={submittingActionId}
            />
          );
        })}
        {models.length === 0 ? (
          <div className="battle-unit-empty" role="img" aria-label="空置模型槽">
            <Sparkles size={15} />
          </div>
        ) : null}
      </div>
      {looseTechnologies.length > 0 || attachedTechnologyIds.size > 0 ? (
        <div className="battle-technology-row">
          {attachedTechnologyIds.size > 0 ? (
            <span className="battle-attachment-count">已挂载 {attachedTechnologyIds.size}</span>
          ) : null}
          {looseTechnologies.map((asset) => (
            <button
              type="button"
              className={`battle-technology-chip ${
                feedback.deployedAssetIds.has(asset.instanceId) ? "deploying" : ""
              }`}
              key={asset.instanceId}
              onClick={() => onSelectAsset({ instanceId: asset.instanceId, cardId: asset.cardId })}
              onMouseEnter={() =>
                onPreview({ kind: "asset", instanceId: asset.instanceId, cardId: asset.cardId })
              }
              onMouseLeave={() => onPreview(null)}
              onFocus={() =>
                onPreview({ kind: "asset", instanceId: asset.instanceId, cardId: asset.cardId })
              }
              onBlur={() => onPreview(null)}
              aria-label={`查看技术 ${cardLookup.get(asset.cardId)?.name ?? asset.cardId}`}
            >
              <Cpu size={11} />
              {cardLookup.get(asset.cardId)?.name ?? asset.cardId}
            </button>
          ))}
        </div>
      ) : null}
      <div className="battle-anchor-statuses">
        {anchor.statuses.map((status) => (
          <span className="battle-status-chip" key={status.id}>
            {labelStatus(status.id)} {status.remainingTurns}
          </span>
        ))}
      </div>
    </article>
  );
}

function ModelUnit({
  asset,
  card,
  attachedTechnologies,
  interactive,
  selected,
  isDefender,
  recentlyDeployed,
  recentlyChanged,
  dropAction,
  onDrop,
  defenderAction,
  onSelect,
  onPreview,
  onPreviewEnd,
  onSubmit,
  submittingActionId,
}: {
  readonly asset: BattleAsset;
  readonly card: BattleCardInfo | undefined;
  readonly attachedTechnologies: readonly {
    readonly asset: BattleAsset;
    readonly card: BattleCardInfo | undefined;
  }[];
  readonly interactive: boolean;
  readonly selected: boolean;
  readonly isDefender: boolean;
  readonly recentlyDeployed: boolean;
  readonly recentlyChanged: boolean;
  readonly dropAction: LegalAction | undefined;
  readonly onDrop: () => void;
  readonly defenderAction: LegalAction | undefined;
  readonly onSelect: () => void;
  readonly onPreview: () => void;
  readonly onPreviewEnd: () => void;
  readonly onSubmit: (action: LegalAction) => Promise<void>;
  readonly submittingActionId: string | null;
}) {
  const defenderActionModelInstanceId =
    defenderAction?.kind === "set_benchmark_defender" ? defenderAction.modelInstanceId : undefined;
  return (
    <article
      className={[
        "battle-model-unit",
        selected ? "selected" : "",
        recentlyDeployed ? "deploying" : "",
        recentlyChanged ? "changed" : "",
        dropAction ? "valid-drop-target" : "",
      ].join(" ")}
      onDragOver={(event) => {
        if (dropAction) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(event) => {
        if (dropAction) {
          event.preventDefault();
          onDrop();
        }
      }}
      onMouseEnter={onPreview}
      onMouseLeave={onPreviewEnd}
    >
      <button
        type="button"
        className="battle-model-main"
        onClick={onSelect}
        onFocus={onPreview}
        onBlur={onPreviewEnd}
        aria-label={`查看 ${card?.name ?? asset.cardId}`}
      >
        <span className="battle-model-kind">
          <Activity size={11} />
          模型
        </span>
        <strong>{card?.name ?? asset.cardId}</strong>
        <div className="battle-model-abilities">
          {card?.abilities
            ? Object.entries(card.abilities)
                .filter(([, value]) => value > 0)
                .map(([ability, value]) => (
                  <span key={ability}>
                    {labelAbility(ability)} <b>{value}</b>
                  </span>
                ))
            : null}
        </div>
      </button>
      {attachedTechnologies.length > 0 ? (
        <div className="battle-model-attachments">
          {attachedTechnologies.map(({ asset: technology, card: technologyCard }) => (
            <span key={technology.instanceId}>{technologyCard?.name ?? technology.cardId}</span>
          ))}
        </div>
      ) : null}
      <div className="battle-model-statuses">
        {asset.statuses.map((status) => (
          <span className="battle-status-chip" key={status.id}>
            {labelStatus(status.id)}
          </span>
        ))}
      </div>
      {isDefender ? (
        <span className="battle-defender-ribbon">
          <ShieldCheck size={11} />
          守擂
        </span>
      ) : null}
      {interactive && defenderAction ? (
        <button
          type="button"
          className="battle-defender-action"
          disabled={submittingActionId === defenderAction.id}
          onClick={() => void onSubmit(defenderAction)}
        >
          <ShieldCheck size={12} />
          {defenderActionModelInstanceId === null ? "取消守擂" : "设为守擂"}
        </button>
      ) : null}
    </article>
  );
}

function findDropAction(
  legalActions: readonly LegalAction[],
  draggedHand: BattleDragState | null,
  anchor: BattleAnchor,
  modelInstanceId?: string,
): LegalAction | undefined {
  if (!draggedHand || anchor.ownerSeatId !== "player") {
    return undefined;
  }
  return legalActions.find((action) => {
    if (action.kind === "deploy_organization") {
      return (
        draggedHand.handKind === "blueprint" &&
        action.cardInstanceId === draggedHand.instanceId &&
        !anchor.isHomeLab &&
        action.slotIndex === anchor.slotIndex
      );
    }
    if (action.kind === "deploy_asset") {
      if (action.cardInstanceId !== draggedHand.instanceId) {
        return false;
      }
      return modelInstanceId
        ? action.attachedModelInstanceId === modelInstanceId
        : action.anchorId === anchor.id && action.attachedModelInstanceId === undefined;
    }
    if (action.kind === "play_action") {
      if (draggedHand.handKind !== "action" || action.actionInstanceId !== draggedHand.instanceId) {
        return false;
      }
      return modelInstanceId
        ? action.targetModelInstanceId === modelInstanceId
        : action.targetAnchorId === anchor.id && action.targetModelInstanceId === undefined;
    }
    return false;
  });
}
