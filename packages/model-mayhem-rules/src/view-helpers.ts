/**
 * 视图层使用的小型只读派生函数。
 *
 * 作者：JucieOvo
 *
 * 这些函数不修改状态，只把规则层已经存在的派生值暴露给界面。
 */

import type { ContentPack } from "@modelmayhem/model-mayhem-content";
import { getAnchorCapacity as calculateAnchorCapacity } from "./modifiers";
import type { MatchState } from "./types";

/** 返回指定据点的最终容量。 */
export function getAnchorCapacity(
  content: ContentPack,
  state: MatchState,
  anchorId: string,
): { readonly base: number; readonly final: number } {
  return calculateAnchorCapacity(content, state, anchorId);
}
