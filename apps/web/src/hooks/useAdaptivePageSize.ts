/**
 * 按桌面视口尺寸计算固定一屏可容纳的项目数量。
 *
 * 作者：JucieOvo
 *
 * 这里只调整分页密度，不改变字体大小。字体通过稳定断点控制，避免随窗口连续缩放
 * 造成视觉尺寸跳动。
 */

import { useEffect, useState } from "react";

function currentPageSize(): number {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (width >= 1700 && height >= 1000) {
    return 20;
  }
  if (width >= 1360 && height >= 820) {
    return 12;
  }
  if (width >= 1100 && height >= 680) {
    return 8;
  }
  return 6;
}

function currentEventPageSize(): number {
  const height = window.innerHeight;
  if (height >= 960) {
    return 18;
  }
  if (height >= 780) {
    return 14;
  }
  return 10;
}

export function useAdaptivePageSize(): number {
  const [pageSize, setPageSize] = useState(currentPageSize);

  useEffect(() => {
    const update = () => setPageSize(currentPageSize());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return pageSize;
}

export function useAdaptiveEventPageSize(): number {
  const [pageSize, setPageSize] = useState(currentEventPageSize);

  useEffect(() => {
    const update = () => setPageSize(currentEventPageSize());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return pageSize;
}
