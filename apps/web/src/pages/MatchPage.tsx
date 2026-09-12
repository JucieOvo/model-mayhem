/**
 * 对局牌桌页面。
 *
 * 作者：JucieOvo
 *
 * 页面以卡牌游戏的战场、手牌、竞技场和结算反馈组织真实规则状态。客户端只展示
 * 服务端返回的公开状态，所有操作仍通过合法行动接口提交。
 */

import type { LegalAction, ModelMayhemView } from "@modelmayhem/model-mayhem-rules";
import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { ContentResponse, MatchResponse } from "../api";
import { api } from "../api";
import { BattleBoard } from "../components/battle/BattleBoard";
import {
  type BattleBroadcastChange,
  type BattleBroadcastMessage,
  BattleBroadcastPanel,
  createBattleBroadcasts,
} from "../components/battle/BattleBroadcast";
import {
  BattleActionPool,
  BattleArena,
  type BattleChromeFeedback,
  BattleHeader,
  BattleTurnBanner,
  BattleWorldEventAnnouncement,
} from "../components/battle/BattleChrome";
import { type BattleDrawBatch, BattleDrawOverlay } from "../components/battle/BattleDrawOverlay";
import { BattleFinished } from "../components/battle/BattleFinished";
import {
  BattleCardZoom,
  type BattleDragState,
  BattleHandDock,
  type BattleSelection,
  BattleTechCheckDialog,
} from "../components/battle/BattleHand";
import { SandboxMatchControls } from "../components/SandboxMatchControls";
import { ErrorMessage, LoadingMessage } from "../components/StatusMessage";
import { TutorialCoach } from "../components/TutorialCoach";
import { legalActionToCommand } from "../legal";
import { useSessionStore } from "../store";

interface BattleBoardFeedback {
  readonly deployedAssetIds: ReadonlySet<string>;
  readonly changedAssetIds: ReadonlySet<string>;
}

interface BattleFeedback extends BattleChromeFeedback, BattleBoardFeedback {}

interface ActionNotice {
  readonly kind: "success" | "error" | "progress";
  readonly message: string;
}

const emptyFeedback: BattleFeedback = {
  deployedAssetIds: new Set(),
  changedAssetIds: new Set(),
  benchmarkPulse: 0,
  worldEventPulse: 0,
  turnPulse: 0,
  influencePlayer: 0,
  influenceAgent: 0,
};

export function MatchPage() {
  const { matchId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const session = useSessionStore();
  const [content, setContent] = useState<ContentResponse | null>(null);
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [legalActions, setLegalActions] = useState<readonly LegalAction[]>([]);
  const [selectedMulligan, setSelectedMulligan] = useState<readonly string[]>([]);
  const [question, setQuestion] = useState<{
    readonly id: string;
    readonly prompt: string;
    readonly options: readonly { readonly id: string; readonly text: string }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(() => Date.now());
  const [handTab, setHandTab] = useState<"blueprint" | "action">("blueprint");
  const [selection, setSelection] = useState<BattleSelection>(null);
  const [dragState, setDragState] = useState<BattleDragState | null>(null);
  const [previewSelection, setPreviewSelection] = useState<BattleSelection>(null);
  const [broadcasts, setBroadcasts] = useState<readonly BattleBroadcastMessage[]>([]);
  const [feedback, setFeedback] = useState<BattleFeedback>(emptyFeedback);
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
  const [drawBatch, setDrawBatch] = useState<BattleDrawBatch | null>(null);
  const [agentStartedAt, setAgentStartedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const resumeAttempted = useRef(false);
  const previousView = useRef<ModelMayhemView | null>(null);
  const feedbackTimer = useRef<number | undefined>(undefined);
  const drawTimer = useRef<number | undefined>(undefined);
  const noticeTimer = useRef<number | undefined>(undefined);
  const pulseCounter = useRef(0);
  const initialBroadcastSeeded = useRef(false);

  const seatToken = session.seatToken;
  const currentMatchId = matchId ?? session.matchId;
  const sandboxMode = searchParams.get("sandbox") === "1";
  const tutorialMode = searchParams.get("tutorial") === "1";
  const cardLookup = useMemo(
    () => new Map((content?.cards ?? []).map((card) => [card.id, card] as const)),
    [content],
  );
  const view = match?.view;
  const agentRunning = match?.agent.running ?? false;

  useEffect(() => {
    api
      .getContent()
      .then(setContent)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, []);

  useEffect(() => {
    if (!currentMatchId || !seatToken) {
      navigate("/");
      return;
    }
    const matchIdForRefresh = currentMatchId;
    const tokenForRefresh = seatToken;
    let cancelled = false;
    async function refresh(): Promise<void> {
      try {
        const [matchValue, legalValue] = await Promise.all([
          api.getMatch(matchIdForRefresh, tokenForRefresh),
          api.getLegalActions(matchIdForRefresh, tokenForRefresh),
        ]);
        if (cancelled) {
          return;
        }
        setMatch(matchValue);
        setLegalActions(legalValue);
        setError(null);
        setLastRefresh(Date.now());
      } catch (reason) {
        if (!cancelled && !resumeAttempted.current) {
          resumeAttempted.current = true;
          try {
            const resumed = await api.resumeMatch(matchIdForRefresh);
            session.setMatch(resumed.matchId, resumed.seatToken);
            setMatch({
              view: resumed.view,
              agent: resumed.agent,
            });
            setError(null);
          } catch (resumeReason) {
            setError(resumeReason instanceof Error ? resumeReason.message : String(resumeReason));
          }
        } else if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [currentMatchId, navigate, seatToken, session.setMatch]);

  useEffect(() => {
    const pending = view?.pendingTechCheck;
    if (!pending || pending.casterSeatId !== view?.viewerSeatId) {
      setQuestion(null);
      return;
    }
    const action = content?.cards.find((card) => card.id === pending.actionCardId);
    const questionId = action?.techCheck?.questionId;
    if (!questionId) {
      return;
    }
    api
      .getQuestion(questionId)
      .then(setQuestion)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, [content, view?.pendingTechCheck, view?.viewerSeatId]);

  useEffect(() => {
    if (!view || !content || initialBroadcastSeeded.current) {
      return;
    }
    initialBroadcastSeeded.current = true;
    const changes: BattleBroadcastChange[] = [{ kind: "match_started" }];
    if (view.worldEvent) {
      changes.push({
        kind: "world_event",
        cardId: view.worldEvent.cardId,
        expiresAfterRound: view.worldEvent.expiresAfterRound,
      });
    }
    setBroadcasts(
      [
        ...createBattleBroadcasts({
          changes,
          cardLookup,
          gameId: view.gameId,
          eventSequence: 0,
          round: view.round,
          playerName: view.me.displayName,
          opponentName: view.opponent.displayName,
        }),
      ].reverse(),
    );
  }, [cardLookup, content, view]);

  useEffect(() => {
    const current = view;
    const previous = previousView.current;
    if (!current) {
      return;
    }
    if (!previous || previous.gameId !== current.gameId) {
      previousView.current = current;
      return;
    }

    const currentAssets = [...current.me.assets, ...current.opponent.assets];
    const previousAssets = [...previous.me.assets, ...previous.opponent.assets];
    const currentAnchors = [...current.me.anchors, ...current.opponent.anchors];
    const previousAnchorOrganizations = new Map(
      [...previous.me.anchors, ...previous.opponent.anchors].map((anchor) => [
        anchor.id,
        anchor.organizationCardId,
      ]),
    );
    const deployedOrganizations = currentAnchors.filter(
      (anchor) =>
        anchor.organizationCardId !== null &&
        previousAnchorOrganizations.get(anchor.id) !== anchor.organizationCardId,
    );
    const deployedAssetIds = new Set(
      currentAssets
        .filter(
          (asset) => !previousAssets.some((candidate) => candidate.instanceId === asset.instanceId),
        )
        .map((asset) => asset.instanceId),
    );
    const changedAssetIds = new Set(
      currentAssets
        .filter((asset) => {
          const previousAsset = previousAssets.find(
            (candidate) => candidate.instanceId === asset.instanceId,
          );
          if (!previousAsset) {
            return false;
          }
          return (
            JSON.stringify(asset.statuses) !== JSON.stringify(previousAsset.statuses) ||
            asset.attachedModelInstanceId !== previousAsset.attachedModelInstanceId
          );
        })
        .map((asset) => asset.instanceId),
    );
    const benchmarkChanged =
      JSON.stringify(current.lastBenchmark) !== JSON.stringify(previous.lastBenchmark);
    const worldEventChanged = current.worldEvent?.cardId !== previous.worldEvent?.cardId;
    const turnChanged =
      current.round !== previous.round || current.activeSeatId !== previous.activeSeatId;
    const influencePlayer = current.me.influence - previous.me.influence;
    const influenceAgent = current.opponent.influence - previous.opponent.influence;
    const previousBlueprintIds = new Set(previous.me.blueprintHand.map((card) => card.instanceId));
    const previousActionIds = new Set(previous.me.actionHand.map((card) => card.id));
    const playerBlueprintCards = current.me.blueprintHand.filter(
      (card) => !previousBlueprintIds.has(card.instanceId),
    );
    const playerActionCards = current.me.actionHand
      .filter((card) => !previousActionIds.has(card.id))
      .map((card) => ({ instanceId: card.id, cardId: card.cardId }));
    const opponentBlueprintCount = Math.max(
      0,
      current.opponent.blueprintHandCount - previous.opponent.blueprintHandCount,
    );
    const opponentActionCount = Math.max(
      0,
      current.opponent.actionHandCount - previous.opponent.actionHandCount,
    );
    const hasDraws =
      playerBlueprintCards.length > 0 ||
      playerActionCards.length > 0 ||
      opponentBlueprintCount > 0 ||
      opponentActionCount > 0;
    const hasChanges =
      deployedAssetIds.size > 0 ||
      changedAssetIds.size > 0 ||
      benchmarkChanged ||
      worldEventChanged ||
      turnChanged ||
      influencePlayer !== 0 ||
      influenceAgent !== 0 ||
      hasDraws;

    previousView.current = current;
    if (!hasChanges) {
      return;
    }
    pulseCounter.current += 1;
    const pulse = pulseCounter.current;
    if (hasDraws) {
      setDrawBatch({
        id: pulse,
        kind: previous.phase === "mulligan" && current.phase !== "mulligan" ? "mulligan" : "turn",
        round: current.round,
        activeSeatId: current.activeSeatId ?? current.viewerSeatId,
        playerBlueprintCards,
        playerActionCards,
        opponentBlueprintCount,
        opponentActionCount,
      });
      if (drawTimer.current !== undefined) {
        window.clearTimeout(drawTimer.current);
      }
      drawTimer.current = window.setTimeout(() => setDrawBatch(null), 1500);
    }
    const broadcastChanges: BattleBroadcastChange[] = [];
    if (worldEventChanged && current.worldEvent) {
      broadcastChanges.push({
        kind: "world_event",
        cardId: current.worldEvent.cardId,
        expiresAfterRound: current.worldEvent.expiresAfterRound,
      });
    }
    for (const anchor of deployedOrganizations) {
      if (anchor.organizationCardId) {
        broadcastChanges.push({
          kind: "organization_deployed",
          cardId: anchor.organizationCardId,
          ownerSeatId: anchor.ownerSeatId,
        });
      }
    }
    for (const asset of currentAssets) {
      if (deployedAssetIds.has(asset.instanceId)) {
        broadcastChanges.push({
          kind: "asset_deployed",
          cardId: asset.cardId,
          ownerSeatId: asset.ownerSeatId,
        });
      }
    }
    if (benchmarkChanged && current.lastBenchmark) {
      broadcastChanges.push({ kind: "benchmark", benchmark: current.lastBenchmark });
    }
    if (hasDraws) {
      broadcastChanges.push({
        kind: "draw",
        playerCount: playerBlueprintCards.length + playerActionCards.length,
        opponentCount: opponentBlueprintCount + opponentActionCount,
      });
    }
    if (turnChanged) {
      broadcastChanges.push({
        kind: "turn",
        activeSeatId: current.activeSeatId,
        playerInfluence: current.me.influence,
        opponentInfluence: current.opponent.influence,
      });
    }
    if (broadcastChanges.length > 0) {
      const messages = createBattleBroadcasts({
        changes: broadcastChanges,
        cardLookup,
        gameId: current.gameId,
        eventSequence: pulse,
        round: current.round,
        playerName: current.me.displayName,
        opponentName: current.opponent.displayName,
      });
      setBroadcasts((existing) => [...messages].reverse().concat(existing).slice(0, 20));
    }
    setFeedback({
      deployedAssetIds,
      changedAssetIds,
      benchmarkPulse: benchmarkChanged ? pulse : 0,
      worldEventPulse: worldEventChanged ? pulse : 0,
      turnPulse: turnChanged ? pulse : 0,
      influencePlayer,
      influenceAgent,
    });
    if (feedbackTimer.current !== undefined) {
      window.clearTimeout(feedbackTimer.current);
    }
    feedbackTimer.current = window.setTimeout(() => {
      setFeedback(emptyFeedback);
    }, 1200);
  }, [cardLookup, view]);

  useEffect(() => {
    if (agentRunning) {
      setAgentStartedAt((current) => current ?? Date.now());
    } else {
      setAgentStartedAt(null);
    }
  }, [agentRunning]);

  useEffect(() => {
    if (!agentRunning) {
      return;
    }
    const interval = window.setInterval(() => setClock(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [agentRunning]);

  useEffect(() => {
    if (view?.phase === "mulligan") {
      setHandTab("blueprint");
    }
  }, [view?.phase]);

  useEffect(() => {
    if ((view?.me.actionHandOverflow ?? 0) > 0) {
      setHandTab("action");
      return;
    }
    if ((view?.me.blueprintHandOverflow ?? 0) > 0) {
      setHandTab("blueprint");
    }
  }, [view?.me.actionHandOverflow, view?.me.blueprintHandOverflow]);

  useEffect(() => {
    if (!selection || !view) {
      return;
    }
    const exists =
      selection.kind === "hand"
        ? view.me.blueprintHand.some((card) => card.instanceId === selection.instanceId) ||
          view.me.actionHand.some((card) => card.id === selection.instanceId)
        : view.me.assets.some((asset) => asset.instanceId === selection.instanceId);
    if (!exists) {
      setSelection(null);
    }
  }, [selection, view]);

  useEffect(
    () => () => {
      if (feedbackTimer.current !== undefined) {
        window.clearTimeout(feedbackTimer.current);
      }
      if (noticeTimer.current !== undefined) {
        window.clearTimeout(noticeTimer.current);
      }
      if (drawTimer.current !== undefined) {
        window.clearTimeout(drawTimer.current);
      }
    },
    [],
  );

  async function submit(action: LegalAction): Promise<void> {
    if (!currentMatchId || !seatToken || submittingActionId !== null) {
      return;
    }
    setSubmittingActionId(action.id);
    setError(null);
    setActionNotice({ kind: "progress", message: "正在提交行动" });
    try {
      await api.submitCommand(
        currentMatchId,
        seatToken,
        `web-${crypto.randomUUID()}`,
        legalActionToCommand(action),
      );
      const [matchValue, legalValue] = await Promise.all([
        api.getMatch(currentMatchId, seatToken),
        api.getLegalActions(currentMatchId, seatToken),
      ]);
      setMatch(matchValue);
      setLegalActions(legalValue);
      setSelectedMulligan([]);
      setDragState(null);
      if (tutorialMode) {
        const tutorialStep =
          action.kind === "mulligan"
            ? "mulligan_completed"
            : action.kind === "deploy_organization"
              ? "organization_deployed"
              : action.kind === "deploy_asset"
                ? "asset_deployed"
                : action.kind === "play_action"
                  ? "action_played"
                  : null;
        if (tutorialStep) {
          void api.completeTutorialStep(tutorialStep);
        }
      }
      setActionNotice({ kind: "success", message: `已执行：${action.label}` });
      if (noticeTimer.current !== undefined) {
        window.clearTimeout(noticeTimer.current);
      }
      noticeTimer.current = window.setTimeout(() => setActionNotice(null), 1800);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      setActionNotice({ kind: "error", message });
    } finally {
      setSubmittingActionId(null);
    }
  }

  if (!content || !match || !view) {
    return <LoadingMessage label="读取对局状态" />;
  }
  if (!currentMatchId) {
    return <ErrorMessage message="对局标识缺失" />;
  }

  const isMyTurn = view.phase === "playing" && view.activeSeatId === view.viewerSeatId;
  const defenderActions = legalActions.filter((action) => action.kind === "set_benchmark_defender");
  const selectedAssetId = selection?.kind === "asset" ? selection.instanceId : null;
  const agentElapsedMs = agentStartedAt === null ? null : Math.max(0, clock - agentStartedAt);
  const drawingInstanceIds = new Set(
    drawBatch
      ? [
          ...drawBatch.playerBlueprintCards.map((card) => card.instanceId),
          ...drawBatch.playerActionCards.map((card) => card.instanceId),
        ]
      : [],
  );
  const activeWorldEvent = view.worldEvent ? cardLookup.get(view.worldEvent.cardId) : undefined;

  if (view.phase === "finished") {
    return (
      <div className="battle-page battle-page-finished">
        <BattleFinished
          view={view}
          onResearch={() => navigate("/research")}
          onReplay={() => navigate(`/replay/${currentMatchId}`)}
          onHome={() => navigate("/")}
        />
      </div>
    );
  }

  return (
    <div className="battle-page battle-page-new">
      <BattleTurnBanner
        pulse={feedback.turnPulse}
        round={view.round}
        activeSeatId={view.activeSeatId}
        viewerSeatId={view.viewerSeatId}
        opponentName={view.opponent.displayName}
      />

      <BattleDrawOverlay
        batch={drawBatch}
        cardLookup={cardLookup}
        playerName={view.me.displayName}
        opponentName={view.opponent.displayName}
      />

      {activeWorldEvent && view.worldEvent ? (
        <BattleWorldEventAnnouncement
          pulse={feedback.worldEventPulse}
          name={activeWorldEvent.name}
          flavor={activeWorldEvent.flavor}
          expiresAfterRound={view.worldEvent.expiresAfterRound}
        />
      ) : null}

      {actionNotice ? (
        <div className={`battle-action-notice ${actionNotice.kind}`} role="status">
          {actionNotice.kind === "success" ? <CheckCircle2 size={15} /> : null}
          {actionNotice.kind === "error" ? <AlertTriangle size={15} /> : null}
          {actionNotice.kind === "progress" ? <LoaderCircle className="spin" size={15} /> : null}
          <span>{actionNotice.message}</span>
        </div>
      ) : null}

      <ErrorMessage message={error} />
      <ErrorMessage message={match.agent.error} />

      {sandboxMode ? <SandboxMatchControls matchId={currentMatchId} /> : null}
      {tutorialMode ? <TutorialCoach view={view} legalActions={legalActions} /> : null}

      <div className="battle-layout-main">
        <aside className="battle-left-rail">
          <BattleHeader
            view={view}
            influenceTarget={content.balance.influenceTarget}
            agentRunning={agentRunning}
            agentElapsedMs={agentElapsedMs}
            feedback={feedback}
            drawingSeatId={drawBatch?.activeSeatId ?? null}
          />
          <BattleActionPool view={view} />
        </aside>

        <div className="battle-stage">
          <BattleBoard
            view={view}
            cardLookup={cardLookup}
            slotCount={content.balance.anchorSlots}
            interactive={isMyTurn}
            feedback={feedback}
            selectedAssetId={selectedAssetId}
            onSelectAsset={(asset) =>
              setSelection(
                asset
                  ? {
                      kind: "asset",
                      instanceId: asset.instanceId,
                      cardId: asset.cardId,
                    }
                  : null,
              )
            }
            defenderActions={defenderActions}
            legalActions={legalActions}
            draggedHand={dragState}
            onPreview={setPreviewSelection}
            onSubmit={submit}
            submittingActionId={submittingActionId}
            arena={
              <BattleArena
                view={view}
                content={content}
                cardLookup={cardLookup}
                feedback={feedback}
              />
            }
          />
        </div>

        <BattleBroadcastPanel messages={broadcasts} />
      </div>

      <BattleHandDock
        view={view}
        content={content}
        cardLookup={cardLookup}
        legalActions={legalActions}
        selection={selection}
        selectedMulligan={selectedMulligan}
        activeTab={handTab}
        submittingActionId={submittingActionId}
        drawingInstanceIds={drawingInstanceIds}
        draggingInstanceId={dragState?.instanceId ?? null}
        onTabChange={setHandTab}
        onSelectMulligan={(instanceId) =>
          setSelectedMulligan((current) =>
            current.includes(instanceId)
              ? current.filter((id) => id !== instanceId)
              : [...current, instanceId],
          )
        }
        onSelect={setSelection}
        onDragStart={setDragState}
        onDragEnd={() => setDragState(null)}
        onPreview={setPreviewSelection}
        onSubmit={submit}
      />

      <BattleCardZoom
        selection={dragState ? null : previewSelection}
        cardLookup={cardLookup}
        view={view}
      />

      <BattleTechCheckDialog
        question={view.pendingTechCheck?.casterSeatId === view.viewerSeatId ? question : null}
        legalActions={legalActions}
        secondsTotal={content.balance.techCheckSeconds}
        submittingActionId={submittingActionId}
        onSubmit={submit}
      />

      <span className="battle-refresh-stamp">
        状态同步 {new Date(lastRefresh).toLocaleTimeString("zh-CN")}
      </span>
    </div>
  );
}
