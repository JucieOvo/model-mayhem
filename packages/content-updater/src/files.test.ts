/**
 * 文件原子写入真实运行测试。
 *
 * 作者：JucieOvo
 *
 * 测试使用临时目录和真实文件系统，验证覆盖已有 JSON 后不会留下临时文件。
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeJsonAtomic } from "./files";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("writeJsonAtomic", () => {
  it("覆盖已有 JSON 后只保留最终文件", () => {
    const directory = mkdtempSync(join(tmpdir(), "model-mayhem-files-"));
    directories.push(directory);
    const target = join(directory, "installation", "active.json");
    writeJsonAtomic(target, { version: 1 });
    writeJsonAtomic(target, { version: 2, contentVersion: "0.2.1" });

    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({
      version: 2,
      contentVersion: "0.2.1",
    });
    expect(readdirSync(join(directory, "installation"))).toEqual(["active.json"]);
  });
});
