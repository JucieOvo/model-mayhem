/**
 * 单卡详情对话框。
 *
 * 作者：JucieOvo
 *
 * 每张卡只显示一个缩略图，侃词按顺序轮换，当前效果直接使用服务端内容包数据。
 */

import { ChevronLeft, ChevronRight, Image, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ContentResponse } from "../api";
import { CardRuleSummary } from "./battle/CardRuleSummary";

type ContentCard = ContentResponse["cards"][number];

export function CardDetailDialog({
  card,
  cardLookup,
  onClose,
}: {
  readonly card: ContentCard;
  readonly cardLookup: ReadonlyMap<string, ContentCard>;
  readonly onClose: () => void;
}) {
  const banter = [card.flavor, ...card.banter];
  const [banterIndex, setBanterIndex] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
      if (event.key === "ArrowLeft") {
        setBanterIndex((value) => (value - 1 + banter.length) % banter.length);
      }
      if (event.key === "ArrowRight") {
        setBanterIndex((value) => (value + 1) % banter.length);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [banter.length, onClose]);

  const currentBanter = banter[banterIndex] ?? "";

  return (
    <div className="card-detail-overlay">
      <section
        className="card-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${card.name} 详情`}
      >
        <button type="button" className="card-detail-close" onClick={onClose} aria-label="关闭">
          <X size={20} />
        </button>

        <div className="card-detail-art">
          {card.thumbnail ? (
            <img src={card.thumbnail} alt="" />
          ) : (
            <Image size={54} aria-hidden="true" />
          )}
        </div>

        <div className="card-detail-title">
          <div>
            <strong>{card.name}</strong>
            <span>
              {card.type} / {card.subtype}
            </span>
          </div>
          <div className="card-detail-cost">
            {card.cost.compute > 0 ? <span>{card.cost.compute} 算力</span> : null}
            {card.cost.capital > 0 ? <span>{card.cost.capital} 资本</span> : null}
          </div>
        </div>

        <div className="card-detail-banter">
          <p>{currentBanter}</p>
          <div className="card-detail-banter-controls">
            <button
              type="button"
              onClick={() => setBanterIndex((value) => (value - 1 + banter.length) % banter.length)}
              disabled={banter.length <= 1}
              aria-label="上一条侃词"
            >
              <ChevronLeft size={17} />
            </button>
            <span>
              侃词 {banterIndex + 1} / {banter.length}
            </span>
            <button
              type="button"
              onClick={() => setBanterIndex((value) => (value + 1) % banter.length)}
              disabled={banter.length <= 1}
              aria-label="下一条侃词"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>

        <div className="card-detail-effects">
          <CardRuleSummary card={card} cardLookup={cardLookup} />
        </div>
      </section>
    </div>
  );
}
