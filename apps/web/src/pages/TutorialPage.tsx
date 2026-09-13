/**
 * 首次运行与交互式教程入口。
 *
 * 作者：JucieOvo
 */

import type { TutorialProgress, TutorialStepId } from "@modelmayhem/contracts";
import { Check, GraduationCap, Play, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { DecksResponse, ProfileResponse } from "../api";
import { api } from "../api";
import { ErrorMessage, LoadingMessage } from "../components/StatusMessage";
import { useSessionStore } from "../store";

const steps: readonly {
  readonly id: TutorialStepId;
  readonly label: string;
  readonly text: string;
}[] = [
  { id: "faction_selected", label: "选择财团", text: "理解玩家是幕后财团，而不是某家公司。" },
  { id: "deck_confirmed", label: "确认预组", text: "查看一套有完整模型和技术的初始牌组。" },
  { id: "mulligan_completed", label: "完成调度", text: "抽到起手牌后保留或弃置再抽。" },
  { id: "organization_deployed", label: "部署组织", text: "把公司或平台放到据点槽位。" },
  { id: "asset_deployed", label: "部署资产", text: "把模型、技术或论文安装到场上。" },
  { id: "action_played", label: "使用行动", text: "从行动手牌执行一张行动牌。" },
  { id: "benchmark_completed", label: "完成对抗", text: "发起并结算一次 Benchmark。" },
  { id: "research_node_unlocked", label: "解锁研究", text: "用结算数据解锁一个节点。" },
];

export function TutorialPage() {
  const navigate = useNavigate();
  const session = useSessionStore();
  const [progress, setProgress] = useState<TutorialProgress | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [decks, setDecks] = useState<DecksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    Promise.all([api.getTutorial(), api.getProfile(), api.getDecks()])
      .then(([progressValue, profileValue, decksValue]) => {
        setProgress(progressValue);
        setProfile(profileValue);
        setDecks(decksValue);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);

  async function startTutorial(): Promise<void> {
    if (!profile?.profile.faction || !decks) {
      setError("请先选择财团并确认预组");
      return;
    }
    const deck = decks.presetDecks.find((entry) => entry.faction === profile.profile.faction);
    if (!deck) {
      setError("没有匹配财团的预组");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const created = await api.createMatch({
        deckId: deck.id,
        difficulty: "trainee",
        tutorial: true,
      });
      session.setMatch(created.matchId, created.seatToken);
      navigate(`/match/${created.matchId}?tutorial=1`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStarting(false);
    }
  }

  async function resetTutorial(): Promise<void> {
    setError(null);
    try {
      setProgress(await api.setTutorialDismissed(false));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  if (error && (!progress || !profile || !decks)) {
    return <ErrorMessage message={error} />;
  }
  if (!progress || !profile || !decks) {
    return <LoadingMessage label="读取教程" />;
  }

  const completed = new Set(progress.completedSteps);
  return (
    <div className="page-screen tutorial-page">
      <section className="panel">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <GraduationCap size={18} color="var(--accent)" />
            <strong>首次运行指导</strong>
          </div>
          <span className="text-xs text-[var(--muted)]">
            {completed.size} / {steps.length}
          </span>
        </div>
        <div className="panel-body">
          <p className="max-w-3xl text-sm leading-6 text-[var(--muted)]">
            教程对局使用正式规则和真实初始牌组。每一步只会在对局中由真实操作自动记录，
            不使用可手动跳过的完成按钮。
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {steps.map((step) => (
              <div
                key={step.id}
                className="rounded-[8px] border border-[var(--line)] bg-[var(--surface-2)] p-4"
              >
                <div className="flex items-center gap-2">
                  {completed.has(step.id) ? (
                    <Check size={17} color="var(--accent)" />
                  ) : (
                    <span className="h-4 w-4 rounded-full border border-[var(--line)]" />
                  )}
                  <strong>{step.label}</strong>
                </div>
                <p className="mt-2 text-sm leading-5 text-[var(--muted)]">{step.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              className="action-button primary"
              disabled={starting || !profile.profile.faction}
              onClick={() => void startTutorial()}
            >
              <Play size={16} />
              {starting ? "创建教程对局" : "开始教程对局"}
            </button>
            <button type="button" className="ghost-button" onClick={() => void resetTutorial()}>
              <RotateCcw size={16} />
              重新显示提示
            </button>
          </div>
        </div>
      </section>
      <ErrorMessage message={error} />
    </div>
  );
}
