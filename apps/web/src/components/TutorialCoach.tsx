/**
 * 对局中的真实规则教程提示。
 *
 * 作者：JucieOvo
 */

import type { TutorialProgress, TutorialStepId } from "@modelmayhem/contracts";
import type { LegalAction, ModelMayhemView } from "@modelmayhem/model-mayhem-rules";
import { Check, GraduationCap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";

const stepLabels: Readonly<Record<TutorialStepId, string>> = {
  faction_selected: "选择财团",
  deck_confirmed: "确认预组",
  mulligan_completed: "完成调度",
  organization_deployed: "部署组织",
  asset_deployed: "部署资产",
  action_played: "使用行动",
  benchmark_completed: "完成 Benchmark",
  research_node_unlocked: "解锁研究",
};

export function TutorialCoach({
  view,
  legalActions,
}: {
  readonly view: ModelMayhemView;
  readonly legalActions: readonly LegalAction[];
}) {
  const [progress, setProgress] = useState<TutorialProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestedSteps = useRef(new Set<TutorialStepId>());

  useEffect(() => {
    void api
      .getTutorial()
      .then(setProgress)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, []);

  useEffect(() => {
    const automaticSteps: TutorialStepId[] = [];
    if (view.me.mulliganReady) {
      automaticSteps.push("mulligan_completed");
    }
    if (view.me.anchors.some((anchor) => !anchor.isHomeLab && anchor.organizationCardId !== null)) {
      automaticSteps.push("organization_deployed");
    }
    if (view.me.assets.length > 0) {
      automaticSteps.push("asset_deployed");
    }
    if (view.lastBenchmark !== null) {
      automaticSteps.push("benchmark_completed");
    }
    for (const stepId of automaticSteps) {
      if (!progress?.completedSteps.includes(stepId) && !requestedSteps.current.has(stepId)) {
        requestedSteps.current.add(stepId);
        void api.completeTutorialStep(stepId).then(setProgress);
      }
    }
  }, [progress, view.lastBenchmark, view.me.anchors, view.me.assets, view.me.mulliganReady]);

  if (!progress) {
    return null;
  }

  const nextIncomplete = Object.keys(stepLabels).find(
    (stepId) => !progress.completedSteps.includes(stepId as TutorialStepId),
  ) as TutorialStepId | undefined;
  const actionPlayable =
    legalActions.some((action) => action.kind === "play_action") || view.me.actionHand.length > 0;

  return (
    <aside className="tutorial-coach">
      <div>
        <GraduationCap size={18} />
        <strong>教程指导</strong>
      </div>
      {nextIncomplete ? (
        <>
          <span>下一步：{stepLabels[nextIncomplete]}</span>
          {nextIncomplete === "action_played" && actionPlayable ? (
            <button
              type="button"
              onClick={() => void api.completeTutorialStep("action_played").then(setProgress)}
            >
              <Check size={14} />
              已完成行动
            </button>
          ) : null}
        </>
      ) : (
        <span>教程步骤已全部完成</span>
      )}
      <small>提示：可以在系统页重新显示教程。</small>
      {error ? <em>{error}</em> : null}
    </aside>
  );
}
