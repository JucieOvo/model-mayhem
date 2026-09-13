/**
 * 对战外研究地图。
 *
 * 作者：JucieOvo
 */

import type { ResearchMapResponse } from "@modelmayhem/contracts";
import { Check, LockKeyhole, Unlock } from "lucide-react";
import { useEffect, useState } from "react";
import type { ContentResponse } from "../api";
import { api } from "../api";
import { ErrorMessage, LoadingMessage } from "../components/StatusMessage";

const branchLabels: Readonly<Record<string, string>> = {
  architecture: "架构",
  training: "训练",
  systems: "系统",
  product: "产品",
};

export function ResearchPage() {
  const [research, setResearch] = useState<ResearchMapResponse | null>(null);
  const [content, setContent] = useState<ContentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);

  useEffect(() => {
    Promise.all([api.getResearch(), api.getContent()])
      .then(([researchValue, contentValue]) => {
        setResearch(researchValue);
        setContent(contentValue);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);

  async function unlock(nodeId: string): Promise<void> {
    setUnlocking(nodeId);
    setError(null);
    try {
      setResearch(await api.unlockResearch(nodeId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUnlocking(null);
    }
  }

  async function advanceEra(): Promise<void> {
    setAdvancing(true);
    setError(null);
    try {
      setResearch(await api.advanceEra());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAdvancing(false);
    }
  }

  if (error && (!research || !content)) {
    return <ErrorMessage message={error} />;
  }
  if (!research || !content) {
    return <LoadingMessage label="读取研究地图" />;
  }

  const cardNames = new Map(content.cards.map((card) => [card.id, card.name]));
  const branches = ["architecture", "training", "systems", "product"] as const;
  const currentEra = research.eras.find((era) => era.eraId === research.timeAdvance.currentEraId);
  const requirement = research.timeAdvance.requirements;
  const completed = research.timeAdvance.completed;

  return (
    <div className="page-screen research-page">
      <section className="panel research-summary-panel">
        <div className="panel-body flex items-center justify-between">
          <div>
            <div className="text-sm text-[var(--muted)]">研究数据</div>
            <div className="metric resource-influence mt-1 text-3xl">{research.researchData}</div>
          </div>
          <div className="text-right text-sm text-[var(--muted)]">
            <div className="font-medium text-[var(--text)]">
              {currentEra?.name ?? research.timeAdvance.currentEraId}
            </div>
            <div className="mt-1">
              时代进度：{completed.total}/{requirement.total}，论文 {completed.paper}/
              {requirement.paper}，技术 {completed.technology}/{requirement.technology}，模型{" "}
              {completed.model}/{requirement.model}
            </div>
            {research.timeAdvance.nextEraId ? (
              <button
                type="button"
                className="action-button mt-3"
                disabled={!research.timeAdvance.canAdvance || advancing}
                onClick={() => void advanceEra()}
              >
                {advancing
                  ? "推进中"
                  : research.timeAdvance.canAdvance
                    ? "推进时间"
                    : "尚未满足推进条件"}
              </button>
            ) : (
              <div className="mt-3">已到达当前时代</div>
            )}
          </div>
        </div>
      </section>

      <ErrorMessage message={error} />

      <div className="research-branch-grid">
        {branches.map((branch) => (
          <section className="panel" key={branch}>
            <div className="panel-header">
              <strong>{branchLabels[branch]}</strong>
              <span className="text-xs text-[var(--muted)]">
                {research.nodes.filter((node) => node.branch === branch && node.unlocked).length}/
                {research.nodes.filter((node) => node.branch === branch).length}
              </span>
            </div>
            <div className="panel-body research-node-list">
              {research.nodes
                .filter((node) => node.branch === branch)
                .sort((left, right) => left.depth - right.depth)
                .map((node) => (
                  <article
                    key={node.nodeId}
                    className={[
                      "research-node",
                      node.unlocked
                        ? "border-[color-mix(in_srgb,var(--accent)_60%,var(--line))] bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface-2))]"
                        : node.available
                          ? "border-[var(--line)] bg-[var(--surface-2)]"
                          : "border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_70%,black)] opacity-70",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-[var(--muted)]">深度 {node.depth}</div>
                        <strong className="mt-1 block text-sm">{node.name}</strong>
                      </div>
                      {node.unlocked ? (
                        <Check size={17} color="var(--accent)" />
                      ) : node.available ? (
                        <Unlock size={17} color="var(--warning)" />
                      ) : (
                        <LockKeyhole size={16} color="var(--muted)" />
                      )}
                    </div>
                    <div className="mt-3 text-xs leading-5 text-[var(--muted)]">
                      奖励：
                      {node.rewardCardIds
                        .map((cardId) => cardNames.get(cardId) ?? cardId)
                        .join(" / ")}
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="resource-influence text-sm">{node.cost} 研究数据</span>
                      {!node.unlocked ? (
                        <button
                          type="button"
                          className="action-button"
                          disabled={
                            !node.available ||
                            node.missingResearchData > 0 ||
                            unlocking === node.nodeId
                          }
                          onClick={() => void unlock(node.nodeId)}
                        >
                          {unlocking === node.nodeId
                            ? "解锁中"
                            : node.missingResearchData > 0
                              ? `还差 ${node.missingResearchData}`
                              : "解锁"}
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
