/**
 * 内容卡牌展示组件。
 *
 * 作者：JucieOvo
 */

import { Image } from "lucide-react";
import type { ReactNode } from "react";

export interface CardTileData {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly subtype: string;
  readonly tags: readonly string[];
  readonly cost: { readonly compute: number; readonly capital: number };
  readonly flavor: string;
  readonly thumbnail?: string;
  readonly banter: readonly string[];
}

export function CardTile({
  card,
  selected = false,
  showArt = true,
  details,
  actions,
  onClick,
}: {
  readonly card: CardTileData;
  readonly selected?: boolean;
  readonly showArt?: boolean;
  readonly details?: ReactNode;
  readonly actions?: ReactNode;
  readonly onClick?: () => void;
}) {
  const balanceView = details !== undefined;
  return (
    <article
      className={`card-tile ${selected ? "selected" : ""}`}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (onClick && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {showArt ? (
        <div className="card-tile-art">
          {card.thumbnail ? (
            <img src={card.thumbnail} alt="" />
          ) : (
            <Image size={24} aria-hidden="true" />
          )}
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-[15px] font-semibold">{card.name}</h3>
          <div className="mt-1 text-xs text-[var(--muted)]">
            {card.type} / {card.subtype}
          </div>
        </div>
        <div className="flex gap-2 text-xs">
          {card.cost.compute > 0 ? (
            <span className="resource-compute">{card.cost.compute} 算力</span>
          ) : null}
          {card.cost.capital > 0 ? (
            <span className="resource-capital">{card.cost.capital} 资本</span>
          ) : null}
        </div>
      </div>
      {!balanceView ? (
        <>
          <div className="mt-3 flex flex-wrap gap-1">
            {card.tags.slice(0, 5).map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <p className="mt-3 min-h-10 text-xs leading-5 text-[var(--muted)]">{card.flavor}</p>
        </>
      ) : null}
      {details ? <div className="card-tile-details">{details}</div> : null}
      {!balanceView && card.banter.length > 0 ? (
        <div className="card-tile-banter-count">额外侃词 {card.banter.length} 条</div>
      ) : null}
      {actions ? <div className="mt-3 flex gap-2">{actions}</div> : null}
    </article>
  );
}
