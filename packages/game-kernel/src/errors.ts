/**
 * 通用游戏内核错误。
 *
 * 作者：JucieOvo
 *
 * 这些错误表示调用方违反内核使用契约。规则拒绝属于正常业务结果，应通过
 * RuleViolation 返回，不能与程序错误混为一谈。
 */

/** 内核调用方式不满足契约时抛出。 */
export class GameKernelError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "GameKernelError";
  }
}
