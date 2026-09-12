/**
 * Pi 对战 Agent 隔离目录测试。
 *
 * 作者：JucieOvo
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiBattleRuntime } from "./runtime";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("createPiBattleRuntime", () => {
  it("把工作区、会话、缓存和临时目录限制在应用数据子目录", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "model-mayhem-agent-runtime-"));
    directories.push(dataRoot);
    const runtime = createPiBattleRuntime({
      rootDirectory: join(dataRoot, "agent-runtime"),
      allowedRootDirectory: dataRoot,
    });

    expect(runtime.rootDirectory).toBe(join(dataRoot, "agent-runtime"));
    expect(existsSync(runtime.workspaceDirectory)).toBe(true);
    expect(existsSync(runtime.sessionsDirectory)).toBe(true);
    expect(existsSync(runtime.cacheDirectory)).toBe(true);
    expect(existsSync(runtime.temporaryDirectory)).toBe(true);
    expect(runtime.environment.HOME).toBe(runtime.rootDirectory);
    expect(runtime.environment.USERPROFILE).toBe(runtime.rootDirectory);
    expect(runtime.environment.TEMP).toBe(runtime.temporaryDirectory);
  });

  it("拒绝把 Agent 运行目录放到应用数据目录之外", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "model-mayhem-agent-runtime-"));
    directories.push(dataRoot);
    expect(() =>
      createPiBattleRuntime({
        rootDirectory: join(dataRoot, "..", "outside"),
        allowedRootDirectory: dataRoot,
      }),
    ).toThrow(/运行目录必须位于应用数据子目录内/);
  });
});
