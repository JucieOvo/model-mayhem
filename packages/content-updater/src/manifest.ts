/**
 * 系统内容清单与目录哈希。
 *
 * 作者：JucieOvo
 *
 * 内容树哈希只覆盖真实文件和相对路径，跳过 Git 元数据，并拒绝符号链接，避免
 * 更新包通过链接越过内容目录。
 */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  return fingerprintPaths(rootDirectory, null);
}

/**
 * 计算来源分支实际拥有的相对路径哈希。
 *
 * 内容源和平衡源只负责仓库中的部分目录，不能再用完整内容树的哈希代表两边版本。
 * 该函数会把路径名和缺失状态也写入哈希，因此删除整个目录同样会被识别为变化。
 */
export function fingerprintContentPaths(
  rootDirectory: string,
  paths: readonly string[],
): ContentDirectoryFingerprint {
  if (paths.length === 0) {
    throw new Error("内容来源路径不能为空");
  }
  return fingerprintPaths(rootDirectory, paths);
}

function fingerprintPaths(
  rootDirectory: string,
  selectedPaths: readonly string[] | null,
): ContentDirectoryFingerprint {
  const hash = createHash("sha256");
  let fileCount = 0;
  let totalBytes = 0;

  const visitDirectory = (directory: string, relativeDirectory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }
      const path = join(directory, entry.name);
      const relativePath =
        relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        throw new Error(`系统内容不能包含符号链接：${relativePath}`);
      }
      if (stat.isDirectory()) {
        updateHash(hash, `D:${relativePath}`);
        visitDirectory(path, relativePath);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`系统内容包含不支持的文件类型：${relativePath}`);
      }
      const bytes = readFileSync(path);
      updateHash(hash, `F:${relativePath}`);
      updateHash(hash, bytes);
      fileCount += 1;
      totalBytes += bytes.length;
    }
  };

  const visitPath = (relativePath: string): void => {
    const path = join(rootDirectory, relativePath);
    if (!existsSync(path)) {
      updateHash(hash, `M:${relativePath}`);
      return;
    }
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      throw new Error(`系统内容不能包含符号链接：${relativePath}`);
    }
    if (stat.isDirectory()) {
      visitDirectory(path, relativePath);
      return;
    }
    if (!stat.isFile()) {
      throw new Error(`系统内容包含不支持的文件类型：${relativePath}`);
    }
    const bytes = readFileSync(path);
    updateHash(hash, `F:${relativePath}`);
    updateHash(hash, bytes);
    fileCount += 1;
    totalBytes += bytes.length;
  };

  const paths = selectedPaths ?? [""];
  for (const relativePath of paths) {
    if (selectedPaths) {
      updateHash(hash, `P:${relativePath}`);
    }
    if (relativePath.length === 0) {
      visitDirectory(rootDirectory, "");
    } else {
      visitPath(relativePath);
    }
  }
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
