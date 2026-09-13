/**
 * 发行包清洁检查。
 *
 * 作者：JucieOvo
 *
 * 检查构建产物和发行入口不包含运行时数据库、日志、环境文件或常见 API Key。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const allowedTextExtensions = new Set([
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
]);
const secretPattern = /\bsk-[A-Za-z0-9_-]{12,}\b/g;
const privateKeyPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const findings = [];

function inspect(path) {
  const name = path.split(/[\\/]/).at(-1);
  const environmentFile = Boolean(name?.startsWith(".env"));
  if (environmentFile && name !== ".env.example") {
    findings.push(`${relative(root, path)}：发行物包含环境文件`);
    return;
  }
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      inspect(join(path, entry));
    }
    return;
  }
  if (!stat.isFile()) {
    return;
  }
  const extension = extname(path);
  if (!allowedTextExtensions.has(extension) && !environmentFile) {
    return;
  }
  const content = readFileSync(path, "utf8");
  const secretMatches = content.match(secretPattern);
  if (secretMatches) {
    findings.push(`${relative(root, path)}：发现疑似 API Key（共 ${secretMatches.length} 个）`);
  }
  const privateKeyMatches = content.match(privateKeyPattern);
  if (privateKeyMatches) {
    findings.push(`${relative(root, path)}：发现疑似私钥（共 ${privateKeyMatches.length} 个）`);
  }
}

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\u0000")
  .filter((entry) => entry.length > 0);
for (const trackedFile of trackedFiles) {
  inspect(join(root, trackedFile));
}

for (const target of ["apps/web/dist"]) {
  const path = join(root, target);
  if (existsSync(path)) {
    inspect(path);
  }
}

const runtimeArtifacts = [
  join(root, "apps", "web", "dist", "data"),
  join(root, "apps", "web", "dist", "logs"),
];
for (const path of runtimeArtifacts) {
  if (existsSync(path)) {
    findings.push(`${relative(root, path)}：构建产物包含运行时目录`);
  }
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(finding);
  }
  process.exitCode = 1;
} else {
  console.log("发行检查通过：未发现环境文件、运行时目录或疑似 API Key。");
}
