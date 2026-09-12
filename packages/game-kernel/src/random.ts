/**
 * 可序列化的确定性随机数封装。
 *
 * 作者：JucieOvo
 *
 * 随机状态会随对局快照保存。相同种子、命令序列与抽取次数必须得到相同结果，
 * 因此业务规则不得直接调用 Math.random 或系统时间。
 */

import { uniformInt } from "pure-rand/distribution/uniformInt";
import { xoroshiro128plus, xoroshiro128plusFromState } from "pure-rand/generator/xoroshiro128plus";
import type { JumpableRandomGenerator } from "pure-rand/types/JumpableRandomGenerator";
import type { RandomSnapshot } from "./types";

/** 确定性随机数生成器，所有随机消费都会增加 draws。 */
export class GameRandom {
  private constructor(
    private readonly generator: JumpableRandomGenerator,
    private readonly draws: number,
  ) {}

  /** 根据根种子创建随机数生成器。 */
  static create(seed: number): GameRandom {
    if (!Number.isSafeInteger(seed)) {
      throw new Error(`随机种子必须是安全整数，收到：${String(seed)}`);
    }
    return new GameRandom(xoroshiro128plus(seed), 0);
  }

  /** 从持久化快照恢复随机数生成器。 */
  static fromSnapshot(snapshot: RandomSnapshot): GameRandom {
    if (snapshot.algorithm !== "xoroshiro128plus") {
      throw new Error(`不支持的随机数算法：${snapshot.algorithm}`);
    }
    return new GameRandom(xoroshiro128plusFromState(snapshot.state), snapshot.draws);
  }

  /** 生成包含上下限的均匀整数。 */
  nextInt(minInclusive: number, maxInclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive)) {
      throw new Error("随机整数范围必须使用整数");
    }
    if (minInclusive > maxInclusive) {
      throw new Error(`随机整数范围无效：${minInclusive} > ${maxInclusive}`);
    }
    return uniformInt(this.generator, minInclusive, maxInclusive);
  }

  /** 无偏洗牌并返回新数组，不修改调用方数组。 */
  shuffle<T>(values: readonly T[]): T[] {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.nextInt(0, index);
      const current = result[index];
      const target = result[swapIndex];
      if (current === undefined || target === undefined) {
        throw new Error("洗牌索引超出数组范围");
      }
      result[index] = target;
      result[swapIndex] = current;
    }
    return result;
  }

  /** 返回可供持久化的随机状态。 */
  snapshot(): RandomSnapshot {
    return {
      algorithm: "xoroshiro128plus",
      state: [...this.generator.getState()],
      draws: this.draws,
    };
  }
}
