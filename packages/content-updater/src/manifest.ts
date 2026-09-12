/**
 * 系统内容清单与目录哈希。
 *
 * 作者：JucieOvo
 *
 * 内容树哈希只覆盖真实文件和相对路径，跳过 Git 元数据，并拒绝符号链接，避免
 * 更新包通过链接越过内容目录。
 */

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parse } from "yaml";

export interface ContentManifestFile {
  readonly id: string;
  readonly version: string;
  readonly rulesetVersion: string;
  readonly balanceId: string;
}

export interface ContentDirectoryFingerprint {
  readonly treeHash: string;
  readonly fileCount: number;
  readonly totalBytes: number;
}

function normalizedRelativePath(rootDirectory: string, path: string): string {
  return relative(rootDirectory, path).split(sep).join("/");
}

function updateHash(hash: ReturnType<typeof createHash>, value: string | Buffer): void {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

export function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function fingerprintContentDirectory(rootDirectory: string): ContentDirectoryFingerprint {
  const hash = createHash("sha256");
  let fileCount = 0;
  let totalBytes = 0;

  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        throw new Error(`系统内容不能包含符号链接：${normalizedRelativePath(rootDirectory, path)}`);
      }
      if (stat.isDirectory()) {
        updateHash(hash, `D:${normalizedRelativePath(rootDirectory, path)}`);
        visit(path);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(
          `系统内容包含不支持的文件类型：${normalizedRelativePath(rootDirectory, path)}`,
        );
      }
      const bytes = readFileSync(path);
      updateHash(hash, `F:${normalizedRelativePath(rootDirectory, path)}`);
      updateHash(hash, bytes);
      fileCount += 1;
      totalBytes += bytes.length;
    }
  };

  visit(rootDirectory);
  return {
    treeHash: hash.digest("hex"),
    fileCount,
    totalBytes,
  };
}

export function findManifestFile(contentRoot: string): string {
  const manifestRoot = join(contentRoot, "manifest");
  const entries = readdirSync(manifestRoot, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".yaml"),
  );
  if (entries.length !== 1) {
    throw new Error(`系统内容必须恰好包含一份 manifest YAML，当前为 ${entries.length}`);
  }
  const entry = entries[0];
  if (!entry) {
    throw new Error("系统内容缺少 manifest YAML");
  }
  return join(manifestRoot, entry.name);
}

export function readContentManifest(contentRoot: string): ContentManifestFile {
  const manifestFile = findManifestFile(contentRoot);
  const document = parse(readFileSync(manifestFile, "utf8")) as unknown;
  if (
    typeof document !== "object" ||
    document === null ||
    !("id" in document) ||
    !("version" in document) ||
    !("rulesetVersion" in document) ||
    !("balanceId" in document) ||
    typeof document.id !== "string" ||
    typeof document.version !== "string" ||
    typeof document.rulesetVersion !== "string" ||
    typeof document.balanceId !== "string"
  ) {
    throw new Error("内容 manifest 缺少有效版本字段");
  }
  return {
    id: document.id,
    version: document.version,
    rulesetVersion: document.rulesetVersion,
    balanceId: document.balanceId,
  };
}

export function contentManifestHash(contentRoot: string): string {
  return hashText(readFileSync(findManifestFile(contentRoot), "utf8"));
}
