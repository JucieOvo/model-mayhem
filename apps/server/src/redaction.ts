/**
 * 日志和诊断输出的秘密脱敏。
 *
 * 作者：JucieOvo
 *
 * 所有可能进入日志或错误详情的值都先经过该模块。这里既处理结构化字段，也处理
 * 消息正文中的 Bearer、座位令牌和常见 API Key 形态。
 */

const sensitiveKeyPattern =
  /(api[-_]?key|authorization|seat[-_]?token|access[-_]?token|secret|password)/i;
const bearerPattern = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const deepSeekKeyPattern = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const credentialUrlPattern = /\bhttps?:\/\/[^/\s@]+@/gi;

function redactString(value: string): string {
  return value
    .replace(deepSeekKeyPattern, "[REDACTED_SECRET]")
    .replace(bearerPattern, "Bearer [REDACTED_SECRET]")
    .replace(credentialUrlPattern, "https://[REDACTED]@");
}

/** 递归脱敏结构化值，保留普通调试字段。 */
export function redactSecrets(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry, seen));
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = sensitiveKeyPattern.test(key) ? "[REDACTED_SECRET]" : redactSecrets(entry, seen);
  }
  return result;
}

/** 将未知异常转换为可安全记录的结构。 */
export function safeError(error: unknown): {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactString(error.message),
      ...(error.stack ? { stack: redactString(error.stack) } : {}),
    };
  }
  return {
    name: "UnknownError",
    message: redactString(String(error)),
  };
}

/** 判断环境中的 DeepSeek Key 是否可用，不返回 Key 内容。 */
export function isDeepSeekKeyConfigured(environment: NodeJS.ProcessEnv = process.env): boolean {
  return typeof environment.DEEPSEEK_API_KEY === "string"
    ? environment.DEEPSEEK_API_KEY.trim().length > 0
    : false;
}

/** 从任意文本中移除常见密钥，用于诊断包。 */
export function redactText(value: string): string {
  return redactString(value);
}
