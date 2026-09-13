/**
 * 更新系统使用的原子 JSON 与目录操作。
 *
 * 作者：JucieOvo
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  try {
    renameSync(temporaryPath, path);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "EEXIST" || error.code === "EPERM")
    ) {
      // Windows 在目标文件已存在时可能拒绝直接覆盖。先把旧文件移到同目录备份，
      // 再替换；若替换失败则恢复旧文件，避免在删除与写入之间留下空档。
      const backupPath = `${path}.${process.pid}.${Date.now()}.bak`;
      if (existsSync(path)) {
        renameSync(path, backupPath);
      }
      try {
        renameSync(temporaryPath, path);
      } catch (replacementError) {
        if (existsSync(backupPath) && !existsSync(path)) {
          renameSync(backupPath, path);
        }
        throw replacementError;
      }
      rmSync(backupPath, { force: true });
      return;
    }
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function copyContentDirectory(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  const stagingDirectory = `${destination}.staging`;
  rmSync(stagingDirectory, { recursive: true, force: true });
  try {
    cpSync(source, stagingDirectory, {
      recursive: true,
      dereference: false,
      filter: (path) => !path.split(/[\\/]/).includes(".git"),
    });
    renameSync(stagingDirectory, destination);
  } catch (error) {
    rmSync(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function releaseContentDirectory(releasesRoot: string, contentTreeHash: string): string {
  return join(releasesRoot, contentTreeHash, "content");
}
