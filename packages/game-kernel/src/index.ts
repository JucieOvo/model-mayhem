/**
 * 通用游戏内核入口。
 *
 * 作者：JucieOvo
 *
 * 对外导出稳定状态机契约、运行时、随机数和错误类型。具体游戏只能依赖本模块，
 * 不能反向要求内核依赖某个题材。
 */

export * from "./errors";
export * from "./random";
export * from "./runtime";
export * from "./types";
