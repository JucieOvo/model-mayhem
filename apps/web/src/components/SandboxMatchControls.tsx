/**
 * 沙盒对局中的悬浮作弊控制。
 *
 * 作者：JucieOvo
 */

import { Coins, Eye, Skull, Sparkles, Zap } from "lucide-react";
import { useState } from "react";
import { api } from "../api";

export function SandboxMatchControls({ matchId }: { readonly matchId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(
    command:
      | {
          readonly kind: "grant_match_resource";
          readonly matchId: string;
          readonly resource: "compute" | "capital";
          readonly amount: number;
        }
      | { readonly kind: "set_match_influence"; readonly matchId: string; readonly amount: number }
      | { readonly kind: "instant_win"; readonly matchId: string },
  ): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.runSandboxCommand(command);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function reveal(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.runSandboxCommand({ kind: "reveal_opponent", matchId });
      setMessage(`对手完整状态：${JSON.stringify(result.after).slice(0, 300)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="sandbox-match-controls">
      <strong>沙盒作弊台</strong>
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run({
              kind: "grant_match_resource",
              matchId,
              resource: "compute",
              amount: 10,
            })
          }
        >
          <Zap size={14} /> +10 算力
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run({
              kind: "grant_match_resource",
              matchId,
              resource: "capital",
              amount: 10,
            })
          }
        >
          <Coins size={14} /> +10 资本
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run({ kind: "set_match_influence", matchId, amount: 17 })}
        >
          <Sparkles size={14} /> 影响力 17
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run({ kind: "instant_win", matchId })}
        >
          <Skull size={14} /> 直接胜利
        </button>
        <button type="button" disabled={busy} onClick={() => void reveal()}>
          <Eye size={14} /> 查看对手
        </button>
      </div>
      {message ? <span>{message}</span> : null}
    </aside>
  );
}
