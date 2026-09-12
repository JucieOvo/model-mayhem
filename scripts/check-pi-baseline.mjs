/**
 * Pi 源码快照与运行时依赖检查。
 *
 * 作者：JucieOvo
 *
 * 该脚本核对 vendor 快照文件数、两份 Pi 包版本和 Model Mayhem 适配器声明的
 * 精确依赖版本。检查失败时直接退出，不静默改用其他版本。
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const vendorRoot = join(projectRoot, "vendor", "pi-agent");
const baselinePath = join(projectRoot, "vendor", "PIAGENT_BASELINE.md");
const adapterPath = join(projectRoot, "packages", "pi-agent-adapter", "package.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function countFiles(directory) {
  let count = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(path);
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

const baseline = readFileSync(baselinePath, "utf8");
const expectedFileCount = Number(baseline.match(/快照文件数为\s*(\d+)/)?.[1]);
if (!Number.isInteger(expectedFileCount)) {
  throw new Error("PIAGENT_BASELINE.md 缺少快照文件数");
}
const actualFileCount = countFiles(vendorRoot);
if (actualFileCount !== expectedFileCount) {
  throw new Error(`Pi 快照文件数不一致：预期 ${expectedFileCount}，实际 ${actualFileCount}`);
}

const packages = [
  {
    name: "@earendil-works/pi-agent-core",
    packagePath: join(vendorRoot, "packages", "agent", "package.json"),
  },
  {
    name: "@earendil-works/pi-ai",
    packagePath: join(vendorRoot, "packages", "ai", "package.json"),
  },
];
const adapter = readJson(adapterPath);
const verifiedVersions = [];
for (const packageInfo of packages) {
  const vendorPackage = readJson(packageInfo.packagePath);
  if (vendorPackage.name !== packageInfo.name) {
    throw new Error(`Pi 包名称不一致：预期 ${packageInfo.name}，实际 ${vendorPackage.name}`);
  }
  const dependencyVersion = adapter.dependencies?.[packageInfo.name];
  if (dependencyVersion !== vendorPackage.version) {
    throw new Error(
      `${packageInfo.name} 版本不一致：快照 ${vendorPackage.version}，适配器 ${String(dependencyVersion)}`,
    );
  }
  verifiedVersions.push(`${packageInfo.name}@${vendorPackage.version}`);
}

console.log(`Pi 基线检查通过：${actualFileCount} 个文件，${verifiedVersions.join("，")}`);
