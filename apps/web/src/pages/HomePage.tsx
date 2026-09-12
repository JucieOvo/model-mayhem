/**
 * 实验室首页。
 *
 * 作者：JucieOvo
 *
 * 首屏直接展示继续对局、标准对战、研究进度和当前牌组。
 */

import {
  type ResearchMapResponse,
  TUTORIAL_STEP_IDS,
  type TutorialProgress,
} from "@modelmayhem/contracts";
import { ArrowRight, FlaskConical, GraduationCap, Play, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { ContentResponse, DecksResponse, ProfileResponse } from "../api";
import { ApiError, api } from "../api";
import { ErrorMessage, LoadingMessage } from "../components/StatusMessage";
import { useSessionStore } from "../store";

export function HomePage() {
  const navigate = useNavigate();
  const session = useSessionStore();
  const [content, setContent] = useState<ContentResponse | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [decks, setDecks] = useState<DecksResponse | null>(null);
  const [research, setResearch] = useState<ResearchMapResponse | null>(null);
  const [tutorial, setTutorial] = useState<TutorialProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [settingFaction, setSettingFaction] = useState(false);
  const [sessionState, setSessionState] = useState<"none" | "checking" | "valid">(
    session.matchId && session.seatToken ? "checking" : "none",
  );

  useEffect(() => {
    Promise.all([
      api.getContent(),
      api.getProfile(),
      api.getDecks(),
      api.getResearch(),
      api.getTutorial(),
    ])
      .then(([contentValue, profileValue, decksValue, researchValue, tutorialValue]) => {
        setContent(contentValue);
        setProfile(profileValue);
        setDecks(decksValue);
        setResearch(researchValue);
        setTutorial(tutorialValue);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!session.matchId || !session.seatToken) {
      setSessionState("none");
      return;
    }
    setSessionState("checking");
    api
      .getMatch(session.matchId, session.seatToken)
      .then(() => {
        if (!cancelled) {
          setSessionState("valid");
        }
      })
      .catch((reason: unknown) => {
        if (cancelled) {
          return;
        }
        if (reason instanceof ApiError && (reason.status === 401 || reason.status === 404)) {
          session.clearMatch();
          setSessionState("none");
          return;
        }
        setSessionState("none");
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [session.clearMatch, session.matchId, session.seatToken]);

  async function startMatch(deckId: string): Promise<void> {
    if (!profile?.profile.faction) {
      setError("请先选择中国财团或西方财团");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const created = await api.createMatch({
        deckId,
        difficulty: "trainee",
      });
      session.setMatch(created.matchId, created.seatToken);
      navigate(`/match/${created.matchId}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStarting(false);
    }
  }

  async function chooseFaction(faction: "china" | "west"): Promise<void> {
    setSettingFaction(true);
    setError(null);
    try {
      const updatedProfile = await api.setProfileFaction(faction);
      setProfile((current) =>
        current
          ? {
              ...current,
              profile: updatedProfile,
            }
          : current,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSettingFaction(false);
    }
  }

  if (error && !content) {
    return <ErrorMessage message={error} />;
  }
  if (!content || !profile || !decks || !research) {
    return <LoadingMessage label="读取本地实验室" />;
  }

  if (profile.profile.faction === null) {
    return (
      <div className="page-screen home-page">
        <section className="panel home-hero">
          <div className="panel-body">
            <div className="text-sm text-[var(--accent-strong)]">MODEL MAYHEM / 财团身份</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">选择长期投资网络</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              财团决定你可以直接控制的公司据点。技术、论文、开放权重和全球平台不受该限制。
              标准对战中，对战 Agent 会自动使用与你相反的财团。
            </p>
            <div className="mt-6 grid max-w-3xl grid-cols-2 gap-4">
              <button
                type="button"
                className="action-button primary min-h-24"
                disabled={settingFaction}
                onClick={() => void chooseFaction("china")}
              >
                中国财团
              </button>
              <button
                type="button"
                className="action-button primary min-h-24"
                disabled={settingFaction}
                onClick={() => void chooseFaction("west")}
              >
                西方财团
              </button>
            </div>
            <ErrorMessage message={error} />
          </div>
        </section>
      </div>
    );
  }

  const nextNodes = research.nodes
    .filter((node) => !node.unlocked && node.available)
    .sort((left, right) => left.cost - right.cost)
    .slice(0, 4);
  const selectedDeck = decks.presetDecks.find((deck) => deck.faction === profile.profile.faction);
  if (!selectedDeck) {
    throw new Error("内容包没有与当前财团匹配的初始预组");
  }

  return (
    <div className="page-screen home-page">
      <section className="panel home-hero">
        <div className="panel-body grid grid-cols-[1.4fr_1fr] gap-6">
          <div>
            <div className="text-sm text-[var(--accent-strong)]">
              MODEL MAYHEM / {content.manifest.version}
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">模型大战魔型</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              把公司、模型、技术、论文、价格战和社区事件放进同一张牌桌。
            </p>
            <div className="mt-5 flex gap-3">
              {sessionState === "valid" && session.matchId ? (
                <button
                  type="button"
                  className="action-button primary"
                  onClick={() => navigate(`/match/${session.matchId}`)}
                >
                  <RotateCcw size={16} />
                  继续对局
                </button>
              ) : null}
              <button
                type="button"
                className="action-button primary"
                disabled={starting}
                onClick={() => void startMatch(selectedDeck.id)}
              >
                <Play size={16} />
                {starting ? "创建对局" : "标准对战"}
              </button>
              <button type="button" className="ghost-button" onClick={() => navigate("/deck")}>
                配置牌组
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Metric
              label="研究数据"
              value={profile.profile.researchData}
              tone="resource-influence"
            />
            <Metric
              label="财团"
              value={profile.profile.faction === "china" ? "中国财团" : "西方财团"}
            />
            <Metric
              label="研究节点"
              value={`${research.nodes.filter((node) => node.unlocked).length} / ${research.nodes.length}`}
            />
            <Metric label="卡牌收藏" value={profile.collectionCardIds.length} />
          </div>
        </div>
      </section>

      <ErrorMessage message={error} />

      {tutorial &&
      tutorial.completedSteps.length < TUTORIAL_STEP_IDS.length &&
      !tutorial.dismissed ? (
        <section className="panel">
          <div className="panel-body flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <GraduationCap size={22} color="var(--accent)" />
              <div>
                <strong>首次运行指导</strong>
                <div className="mt-1 text-sm text-[var(--muted)]">
                  用真实规则完成一次抽牌、部署、行动、Benchmark 和研究解锁。
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="action-button primary"
                onClick={() => navigate("/tutorial")}
              >
                进入教程
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() =>
                  void api.setTutorialDismissed(true).then((value) => setTutorial(value))
                }
              >
                不再提示
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <div className="home-lower-grid">
        <section className="panel home-research-panel">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <FlaskConical size={17} color="var(--accent)" />
              <strong>下一批研究节点</strong>
            </div>
            <button type="button" className="ghost-button" onClick={() => navigate("/research")}>
              打开研究地图
            </button>
          </div>
          <div className="panel-body space-y-3">
            {nextNodes.map((node) => (
              <div
                key={node.nodeId}
                className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-[var(--line)] pb-3 last:border-0 last:pb-0"
              >
                <div>
                  <div className="font-medium">{node.nodeId}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    奖励：{node.rewardCardIds.join(" / ")}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="resource-influence">{node.cost} 研究数据</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    还差 {node.missingResearchData}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel home-deck-panel">
          <div className="panel-header">
            <strong>当前实验牌组</strong>
            <span className="text-xs text-[var(--muted)]">
              {selectedDeck.blueprintCardIds.length} 蓝图 / {selectedDeck.signatureActionIds.length}{" "}
              招牌
            </span>
          </div>
          <div className="panel-body">
            <div className="text-lg font-semibold">{selectedDeck.name}</div>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{selectedDeck.description}</p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[var(--muted)]">方针</div>
                <div className="mt-1">
                  {content.doctrines.find((doctrine) => doctrine.id === selectedDeck.doctrineId)
                    ?.name ?? selectedDeck.doctrineId}
                </div>
              </div>
              <div>
                <div className="text-[var(--muted)]">财团 / 招牌</div>
                <div className="mt-1">
                  {selectedDeck.faction === "china" ? "中国财团" : "西方财团"} ·{" "}
                  {selectedDeck.signatureActionIds.length} / 2
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly tone?: string;
}) {
  return (
    <div className="rounded-[7px] border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className={`metric mt-1 text-2xl ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
