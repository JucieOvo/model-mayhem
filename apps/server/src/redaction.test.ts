/**
 * 秘密脱敏测试。
 *
 * 作者：JucieOvo
 */

import { describe, expect, it } from "vitest";
import { isDeepSeekKeyConfigured, redactSecrets } from "./redaction";

describe("redactSecrets", () => {
  it("不会输出 API Key、Bearer 头或座位令牌", () => {
    const value = redactSecrets({
      apiKey: "secret-placeholder-value",
      authorization: "Bearer seat-token-value",
      nested: {
        seatToken: "seat-token-value",
        message:
          "Authorization: Bearer final-secret-value; remote=https://user:password@example.com/repo.git",
      },
    }) as Record<string, unknown>;
    expect(JSON.stringify(value)).not.toContain("secret-value");
    expect(JSON.stringify(value)).not.toContain("seat-token-value");
    expect(JSON.stringify(value)).not.toContain("password@example.com");
    expect(JSON.stringify(value)).toContain("[REDACTED_SECRET]");
  });

  it("只报告 Key 是否配置", () => {
    expect(isDeepSeekKeyConfigured({ DEEPSEEK_API_KEY: "test-key-placeholder" })).toBe(true);
    expect(isDeepSeekKeyConfigured({ DEEPSEEK_API_KEY: "   " })).toBe(false);
    expect(isDeepSeekKeyConfigured({ DEEPSEEK_API_KEY: "" })).toBe(false);
    expect(isDeepSeekKeyConfigured({})).toBe(false);
  });
});
