/**
 * 构建不含内部开发状态的公开源码发行目录。
 *
 * 作者：JucieOvo
 *
 * 脚本只复制公开发行需要的内容，并扫描输出中是否残留本机路径、运行数据、
 * 内部任务文档或常见密钥形态。任何命中都会使构建失败。
 */

import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--confirm")) {
  throw new Error("公开发行构建会创建新的 release 目录，必须显式传入 --confirm。");
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const releaseRoot = resolve(
  process.env.MODELMAYHEM_RELEASE_DIR ??
    join(projectRoot, "release", `modelmayhem-${packageJson.version}-${timestamp}`),
);
const relativeRelease = relative(projectRoot, releaseRoot);
if (relativeRelease === "" || relativeRelease.startsWith("..")) {
  throw new Error(`拒绝在工作区外构建发布目录：${releaseRoot}`);
}

const excludedDirectories = new Set([
  ".git",
  ".runtime",
  "coverage",
  "data",
  "dist",
  "node_modules",
  "release",
  "release-backups",
]);
const excludedPrefixes = [
  "docs/tasks/",
  "docs/decisions/",
  "docs/design/",
  "docs/content/",
  "vendor/",
];
const excludedFiles = new Set([".env", ".env.local", ".env.production"]);
const excludedExtensions = new Set([
  ".bak",
  ".cer",
  ".crt",
  ".db",
  ".key",
  ".log",
  ".p12",
  ".pem",
  ".pfx",
  ".sqlite",
]);
const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAIza[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/,
];
const absolutePathPatterns = [
  /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/,
  /\/Users\/[^/\s]+\//,
  /\/home\/[^/\s]+\//,
  /\/mnt\/[^/\s]+\//,
];
const findings = [];

function normalized(path) {
  return relative(projectRoot, path).split("\\").join("/");
}

function shouldExclude(path) {
  const projectPath = normalized(path);
  const name = projectPath.split("/").at(-1) ?? projectPath;
  const comparisonPath = statSync(path).isDirectory() ? `${projectPath}/` : projectPath;
  if (excludedDirectories.has(name)) {
    return true;
  }
  if (excludedPrefixes.some((prefix) => comparisonPath.startsWith(prefix))) {
    return true;
  }
  if (projectPath.startsWith("docs/2026-")) {
    return true;
  }
  if (excludedFiles.has(name) || excludedExtensions.has(extname(name).toLowerCase())) {
    return true;
  }
  return name.includes(".sqlite-");
}

function copyPublicTree(source, destination) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    if (shouldExclude(sourcePath)) {
      continue;
    }
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destinationPath, { recursive: true });
      copyPublicTree(sourcePath, destinationPath);
      continue;
    }
    if (entry.isFile()) {
      mkdirSync(dirname(destinationPath), { recursive: true });
      cpSync(sourcePath, destinationPath);
    }
  }
}

function scanRelease(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) {
      scanRelease(target);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    if (
      ![
        ".css",
        ".html",
        ".js",
        ".json",
        ".md",
        ".mjs",
        ".ps1",
        ".ts",
        ".tsx",
        ".yaml",
        ".yml",
      ].includes(extension)
    ) {
      continue;
    }
    const content = readFileSync(target, "utf8");
    const releasePath = relative(releaseRoot, target).split("\\").join("/");
    for (const pattern of secretPatterns) {
      if (pattern.test(content)) {
        findings.push(`${releasePath}：包含疑似密钥形态`);
        break;
      }
    }
    for (const pattern of absolutePathPatterns) {
      if (pattern.test(content)) {
        findings.push(`${releasePath}：包含本机绝对路径`);
        break;
      }
    }
  }
}

function gitValue(args) {
  try {
    return execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

rmSync(releaseRoot, { recursive: true, force: true });
mkdirSync(releaseRoot, { recursive: true });
copyPublicTree(projectRoot, releaseRoot);
scanRelease(releaseRoot);

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(finding);
  }
  process.exitCode = 1;
} else {
  const fileCount = (() => {
    let count = 0;
    const visit = (path) => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const target = join(path, entry.name);
        if (entry.isDirectory()) {
          visit(target);
        } else if (entry.isFile()) {
          count += 1;
        }
      }
    };
    visit(releaseRoot);
    return count;
  })();
  writeFileSync(
    join(releaseRoot, "RELEASE_MANIFEST.json"),
    `${JSON.stringify(
      {
        name: "model-mayhem-public-source",
        version: packageJson.version,
        generatedAt: new Date().toISOString(),
        gitCommit: gitValue(["rev-parse", "HEAD"]),
        gitDirty: gitValue(["status", "--porcelain"]) !== "",
        fileCount,
        excluded: {
          directories: [...excludedDirectories],
          prefixes: excludedPrefixes,
          files: [...excludedFiles],
          extensions: [...excludedExtensions],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`公开源码发行版已生成：${releaseRoot}`);
  console.log(`文件数：${fileCount + 1}`);
}
