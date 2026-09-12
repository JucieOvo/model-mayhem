/**
 * 更新系统使用的原子 JSON 与目录操作。
 *
 * 作者：JucieOvo
 */

import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

export function copyContentDirectory(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    dereference: false,
    filter: (path) => !path.split(/[\\/]/).includes(".git"),
  });
}

export function releaseContentDirectory(releasesRoot: string, contentTreeHash: string): string {
  return join(releasesRoot, contentTreeHash, "content");
}
