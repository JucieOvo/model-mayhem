/**
 * 对局中的真实规则教程提示。
 *
 * 作者：JucieOvo
 */

import type { TutorialProgress, TutorialStepId } from "@modelmayhem/contracts";
import type { ModelMayhemView } from "@modelmayhem/model-mayhem-rules";
import { GraduationCap } from "lucide-react";
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
  matchId,
  seatToken,
  view,
}: {
  readonly matchId: string;
  readonly seatToken: string;
  readonly view: ModelMayhemView;
}) {
  const [progress, setProgress] = useState<TutorialProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestedSteps = useRef(new Set<TutorialStepId>());
  const retryTimers = useRef(new Map<TutorialStepId, number>());

  useEffect(() => {
    void api
      .getTutorial()
      .then(setProgress)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, []);

  useEffect(() => {
    let disposed = false;
    /** 推进一个真实完成的步骤；失败时保留重试，直到组件卸载或步骤完成。 */
    const advance = (stepId: TutorialStepId): void => {
      void api
        .completeTutorialStep(matchId, seatToken, stepId)
        .then((value) => {
          if (disposed) {
            return;
          }
          setProgress(value);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (disposed) {
            return;
          }
          requestedSteps.current.delete(stepId);
          setError(reason instanceof Error ? reason.message : String(reason));
          const previousTimer = retryTimers.current.get(stepId);
          if (previousTimer !== undefined) {
            window.clearTimeout(previousTimer);
          }
          const timer = window.setTimeout(() => {
            retryTimers.current.delete(stepId);
            if (!disposed) {
              advance(stepId);
            }
          }, 1_500);
          retryTimers.current.set(stepId, timer);
        });
    };
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
    if (view.lastBenchmark?.challengerSeatId === view.viewerSeatId) {
      automaticSteps.push("benchmark_completed");
    }
    for (const stepId of automaticSteps) {
      if (!progress?.completedSteps.includes(stepId) && !requestedSteps.current.has(stepId)) {
        requestedSteps.current.add(stepId);
        advance(stepId);
      }
    }
    return () => {
      disposed = true;
      for (const timer of retryTimers.current.values()) {
        window.clearTimeout(timer);
      }
      retryTimers.current.clear();
    };
  }, [
    matchId,
    progress,
    seatToken,
    view.lastBenchmark,
    view.me.anchors,
    view.me.assets,
    view.me.mulliganReady,
    view.viewerSeatId,
  ]);

  if (!progress) {
    return null;
  }

  const nextIncomplete = Object.keys(stepLabels).find(
    (stepId) => !progress.completedSteps.includes(stepId as TutorialStepId),
  ) as TutorialStepId | undefined;

  return (
    <aside className="tutorial-coach">
      <div>
        <GraduationCap size={18} />
        <strong>教程指导</strong>
      </div>
      {nextIncomplete ? (
        <span>下一步：{stepLabels[nextIncomplete]}</span>
      ) : (
        <span>教程步骤已全部完成</span>
      )}
      <small>提示：可以在教程页重新显示教程。</small>
      {error ? <em>{error}</em> : null}
    </aside>
  );
}
