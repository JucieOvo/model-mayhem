/**
 * 沙盒档案和开发者作弊台。
 *
 * 作者：JucieOvo
 */

import type { MatchDifficulty, SandboxCommand, SandboxStatus } from "@modelmayhem/contracts";
import { Bomb, Coins, FlaskConical, Play, Sparkles, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { ContentResponse, DecksResponse } from "../api";
import { api } from "../api";
import { DifficultySelect } from "../components/DifficultySelect";
import { ErrorMessage, LoadingMessage } from "../components/StatusMessage";
import { useSessionStore } from "../store";

export function SandboxPage() {
  const navigate = useNavigate();
  const session = useSessionStore();
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [content, setContent] = useState<ContentResponse | null>(null);
  const [decks, setDecks] = useState<DecksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<MatchDifficulty>("standard");

  async function refresh(): Promise<void> {
    const [statusValue, contentValue, deckValue] = await Promise.all([
      api.getSandboxStatus(),
      api.getContent(),
      api.getDecks(),
    ]);
    setStatus(statusValue);
    setContent(contentValue);
    setDecks(deckValue);
  }

  useEffect(() => {
    void Promise.all([api.getSandboxStatus(), api.getContent(), api.getDecks()])
      .then(([statusValue, contentValue, deckValue]) => {
        setStatus(statusValue);
        setContent(contentValue);
        setDecks(deckValue);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);

  async function command(value: SandboxCommand, label: string): Promise<void> {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      const result = await api.runSandboxCommand(value);
      setMessage(result.message);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function startMatch(deckId: string): Promise<void> {
    setBusy("match");
    setError(null);
    try {
      const created = await api.createSandboxMatch({ deckId, difficulty });
      session.setMatch(created.matchId, created.seatToken);
      navigate(`/match/${created.matchId}?sandbox=1`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  if (error && (!status || !content || !decks)) {
    return <ErrorMessage message={error} />;
  }
  if (!status || !content || !decks) {
    return <LoadingMessage label="读取沙盒档案" />;
  }

  const selectedDeck = status.faction
    ? decks.presetDecks.find((deck) => deck.faction === status.faction)
    : undefined;

  return (
    <div className="page-screen sandbox-page">
      <section className="panel">
        <div className="panel-header">
          <div>
            <strong>沙盒实验室</strong>
            <div className="mt-1 text-xs text-[var(--muted)]">
              官方作弊台只修改沙盒档案，不影响正式档案和系统内容更新。
            </div>
          </div>
          <button
            type="button"
            className="ghost-button"
            disabled={busy !== null}
            onClick={() => void command({ kind: "reset_sandbox" }, "reset")}
          >
            <Bomb size={16} />
            重置沙盒
          </button>
        </div>
        <div className="panel-body grid grid-cols-4 gap-3">
          <Metric label="研究数据" value={status.researchData} />
          <Metric label="收藏" value={`${status.collectionCount} / ${content.cards.length}`} />
          <Metric label="研究节点" value={status.unlockedResearchCount} />
          <Metric label="完成对局" value={status.completedMatches} />
        </div>
      </section>

      {status.faction === null ? (
        <section className="panel">
          <div className="panel-header">
            <strong>选择沙盒财团</strong>
          </div>
          <div className="panel-body flex gap-3">
            <button
              type="button"
              className="action-button primary"
              disabled={busy !== null}
              onClick={() => void command({ kind: "set_faction", faction: "china" }, "china")}
            >
              中国财团
            </button>
            <button
              type="button"
              className="action-button primary"
              disabled={busy !== null}
              onClick={() => void command({ kind: "set_faction", faction: "west" }, "west")}
            >
              西方财团
            </button>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <strong>一键作弊</strong>
          <span className="text-xs text-[var(--muted)]">快速体验全部内容和胜利路线</span>
        </div>
        <div className="panel-body grid grid-cols-3 gap-3">
          <CommandButton
            icon={<Sparkles size={16} />}
            label="解锁全部卡牌"
            disabled={busy !== null}
            onClick={() => void command({ kind: "unlock_all_cards" }, "cards")}
          />
          <CommandButton
            icon={<FlaskConical size={16} />}
            label="解锁全部研究"
            disabled={busy !== null}
            onClick={() => void command({ kind: "unlock_all_research" }, "research")}
          />
          <CommandButton
            icon={<Coins size={16} />}
            label="增加 999999 研究数据"
            disabled={busy !== null}
            onClick={() => void command({ kind: "grant_research_data", amount: 999_999 }, "money")}
          />
          <CommandButton
            icon={<Zap size={16} />}
            label="推进一个时代"
            disabled={busy !== null}
            onClick={() => void command({ kind: "complete_current_era" }, "era")}
          />
          <DifficultySelect
            value={difficulty}
            onChange={setDifficulty}
            disabled={busy !== null}
            className="px-3"
          />
          <CommandButton
            icon={<Play size={16} />}
            label="开始沙盒对局"
            disabled={busy !== null || !selectedDeck}
            onClick={() => selectedDeck && void startMatch(selectedDeck.id)}
          />
        </div>
      </section>

      <ErrorMessage message={error} />
      {message ? <div className="battle-action-notice success">{message}</div> : null}
    </div>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string | number }) {
  return (
    <div className="rounded-[7px] border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="metric mt-1 text-2xl">{value}</div>
    </div>
  );
}

function CommandButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" className="action-button" disabled={disabled} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}
