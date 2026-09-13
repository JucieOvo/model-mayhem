/**
 * 从干净 Git 基线生成可公开分发的发行归档。
 *
 * 作者：JucieOvo
 *
 * 脚本先执行真实发行检查，再使用 git archive 应用 .gitattributes 中的
 * export-ignore 规则，避免把数据库、日志、环境文件、内部任务稿和 vendor 快照装入归档。
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const version = String(packageJson.version);
const outputDirectory = join(projectRoot, "release-backups");
const archiveName = `modelmayhem-v${version}.zip`;
const archivePath = join(outputDirectory, archiveName);
const temporaryArchivePath = `${archivePath}.${process.pid}.tmp`;
const manifestPath = join(outputDirectory, `modelmayhem-v${version}.release.json`);

function run(command, args) {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function resolvePnpmCli() {
  const candidates = [
    process.env.npm_execpath,
    process.env.PNPM_HOME ? join(process.env.PNPM_HOME, "pnpm.cjs") : undefined,
    process.env.PNPM_HOME ? join(process.env.PNPM_HOME, "bin", "pnpm.cjs") : undefined,
    join(dirname(process.execPath), "node_modules", "pnpm", "bin", "pnpm.cjs"),
    join(dirname(process.execPath), "..", "lib", "node_modules", "pnpm", "bin", "pnpm.cjs"),
  ];
  const candidate = candidates.find(
    (value) => typeof value === "string" && /\.(?:cjs|mjs|js)$/i.test(value) && existsSync(value),
  );
  if (!candidate) {
    throw new Error("未找到 pnpm 的 JavaScript 入口，无法执行发行验证");
  }
  return candidate;
}

function runPnpm(args) {
  execFileSync(process.execPath, [resolvePnpmCli(), ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
}

function assertCleanWorktree() {
  const status = run("git", ["status", "--porcelain", "--untracked-files=all"]);
  if (status.length > 0) {
    throw new Error(`工作区不干净，拒绝生成发行归档：\n${status}`);
  }
}

function assertArchivePaths(path) {
  const entries = run("tar", ["-tf", path]);
  const forbidden = [
    "/data/",
    "/node_modules/",
    "/vendor/",
    "/release-backups/",
    "/docs/tasks/",
    "/docs/decisions/",
    "/docs/design/",
    "/docs/content/",
  ];
  for (const line of entries.split(/\r?\n/)) {
    const fileName = line.split("/").at(-1) ?? line;
    const environmentFile = fileName.startsWith(".env") && fileName !== ".env.example";
    if (environmentFile || forbidden.some((segment) => line.includes(segment))) {
      throw new Error(`发行归档包含禁止路径：${line}`);
    }
  }
}

runPnpm(["verify:release"]);
assertCleanWorktree();
if (existsSync(archivePath) || existsSync(manifestPath)) {
  throw new Error(`发行归档已存在，请先人工确认是否覆盖：${basename(archivePath)}`);
}
mkdirSync(outputDirectory, { recursive: true });

try {
  run("git", [
    "archive",
    "--format=zip",
    `--prefix=modelmayhem-v${version}/`,
    `--output=${temporaryArchivePath}`,
    "HEAD",
  ]);
  assertArchivePaths(temporaryArchivePath);
  renameSync(temporaryArchivePath, archivePath);
} catch (error) {
  rmSync(temporaryArchivePath, { force: true });
  throw error;
}

const commit = run("git", ["rev-parse", "HEAD"]);
const archiveHash = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      version,
      commit,
      archive: basename(archivePath),
      sha256: archiveHash,
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  { encoding: "utf8", flag: "wx" },
);
console.log(`发行归档已生成：${archivePath}`);
console.log(`发行清单已生成：${manifestPath}`);
