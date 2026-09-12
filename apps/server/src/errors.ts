/**
 * 服务端可安全返回的结构化错误。
 *
 * 作者：JucieOvo
 *
 * 只有明确标记为 ServiceError 的错误会把消息返回客户端，其他异常由 Hono 统一
 * 记录并返回通用 500，避免泄露文件路径或密钥。
 */

export class ServiceError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
