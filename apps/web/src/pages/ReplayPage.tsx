/**
 * 对局回放页面。
 *
 * 作者：JucieOvo
 */

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../api";
import { Pagination } from "../components/Pagination";
import { ErrorMessage, LoadingMessage } from "../components/StatusMessage";
import { useAdaptiveEventPageSize } from "../hooks/useAdaptivePageSize";
import { useSessionStore } from "../store";

interface ReplayResponse {
  readonly match: {
    readonly id: string;
    readonly rulesetVersion: string;
    readonly contentVersion: string;
    readonly seed: number;
    readonly status: string;
    readonly winnerSeatId: string | null;
    readonly isDraw: boolean;
    readonly finishReason: string | null;
  };
  readonly events: readonly {
    readonly sequence: number;
    readonly type: string;
    readonly actorSeatId: string;
    readonly commandId: string;
    readonly payload: unknown;
    readonly createdAt: string;
  }[];
}

export function ReplayPage() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const session = useSessionStore();
  const [replay, setReplay] = useState<ReplayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = useAdaptiveEventPageSize();

  useEffect(() => {
    if (!matchId || !session.seatToken) {
      navigate("/");
      return;
    }
    api
      .getReplay(matchId, session.seatToken)
      .then((value) => setReplay(value as ReplayResponse))
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, [matchId, navigate, session.seatToken]);

  if (error && !replay) {
    return <ErrorMessage message={error} />;
  }
  if (!replay) {
    return <LoadingMessage label="读取对局回放" />;
  }
  const pageCount = Math.max(1, Math.ceil(replay.events.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleEvents = replay.events.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="page-screen replay-page">
      <section className="panel replay-summary-panel">
        <div className="panel-body grid grid-cols-4 gap-4 text-sm">
          <ReplayMetric label="规则版本" value={replay.match.rulesetVersion} />
          <ReplayMetric label="内容版本" value={replay.match.contentVersion} />
          <ReplayMetric label="随机种子" value={replay.match.seed} />
          <ReplayMetric
            label="结果"
            value={
              replay.match.isDraw ? "平局" : (replay.match.winnerSeatId ?? replay.match.status)
            }
          />
        </div>
      </section>

      <ErrorMessage message={error} />

      <section className="panel replay-log-panel">
        <div className="panel-header">
          <strong>事件日志</strong>
          <span className="text-xs text-[var(--muted)]">{replay.events.length} 条</span>
        </div>
        <div className="panel-body replay-log-body">
          {visibleEvents.map((event) => (
            <div className="event-row" key={`${event.sequence}-${event.type}`}>
              <span className="muted">#{event.sequence}</span>
              <span>
                <strong className="text-sm">{event.type}</strong>
                <span className="ml-2 text-xs text-[var(--muted)]">{event.actorSeatId}</span>
              </span>
              <code className="truncate text-xs text-[var(--muted)]">
                {JSON.stringify(event.payload)}
              </code>
            </div>
          ))}
        </div>
        <Pagination
          page={currentPage}
          pageCount={pageCount}
          total={replay.events.length}
          onPageChange={setPage}
        />
      </section>
    </div>
  );
}

function ReplayMetric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number;
}) {
  return (
    <div>
      <div className="text-[var(--muted)]">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}
