/**
 * 对局结算面板。
 *
 * 作者：JucieOvo
 *
 * 结算页只展示服务端已经确认的结果与公开统计，不预测研究数据奖励。
 */

import type { ModelMayhemView } from "@modelmayhem/model-mayhem-rules";
import { Activity, ArrowLeft, History, Sparkles, Swords } from "lucide-react";
import type { ReactNode } from "react";
import { labelFinishReason } from "./labels";

export function BattleFinished({
  view,
  onResearch,
  onReplay,
  onHome,
}: {
  readonly view: ModelMayhemView;
  readonly onResearch: () => void;
  readonly onReplay: () => void;
  readonly onHome: () => void;
}) {
  const result = view.isDraw ? "平局" : view.winnerSeatId === view.viewerSeatId ? "胜利" : "失败";
  const resultTone = result === "胜利" ? "victory" : result === "失败" ? "defeat" : "draw";
  return (
    <section className={`battle-finished-panel ${resultTone}`}>
      <div className="battle-finished-crest">
        <Swords size={44} />
      </div>
      <span className="battle-finished-eyebrow">对局结束</span>
      <h1>{result}</h1>
      <p className="battle-finished-summary">
        我方影响力 <strong>{view.me.influence}</strong>
        <i />
        对手影响力 <strong>{view.opponent.influence}</strong>
      </p>
      <div className="battle-finished-stats">
        <FinishedMetric label="完成轮次" value={String(view.round)} icon={<History size={15} />} />
        <FinishedMetric
          label="Benchmark 胜场"
          value={String(view.me.benchmarkWins)}
          icon={<Activity size={15} />}
        />
        <FinishedMetric
          label="最高 Benchmark"
          value={String(view.me.highestBenchmarkScore)}
          icon={<Sparkles size={15} />}
        />
      </div>
      <p className="battle-finished-reason">
        结束原因：{view.finishReason ? labelFinishReason(view.finishReason) : "未知"}
      </p>
      <div className="battle-finished-actions">
        <button type="button" className="action-button primary" onClick={onResearch}>
          <Sparkles size={15} />
          查看研究收益
        </button>
        <button type="button" className="ghost-button" onClick={onReplay}>
          <History size={15} />
          查看回放
        </button>
        <button type="button" className="ghost-button" onClick={onHome}>
          <ArrowLeft size={15} />
          返回实验室
        </button>
      </div>
    </section>
  );
}

function FinishedMetric({
  label,
  value,
  icon,
}: {
  readonly label: string;
  readonly value: string;
  readonly icon: ReactNode;
}) {
  return (
    <div>
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
