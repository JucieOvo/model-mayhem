/**
 * 将活动运行态恢复到首次发行状态。
 *
 * 作者：JucieOvo
 *
 * 脚本只删除数据库、安装缓存、日志、临时目录和 Web 构建产物，保留 data/backups、
 * 源码、内容 YAML、迁移和依赖。所有目标在删除前都必须位于项目工作区内。
 */

import { existsSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--confirm")) {
  throw new Error("重置会清除活动数据库和缓存。必须显式传入 --confirm。");
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = resolve(process.env.MODELMAYHEM_DATA_DIR ?? join(projectRoot, "data"));

function assertInsideProject(path) {
  const target = resolve(path);
  const relativePath = relative(projectRoot, target);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`拒绝清理工作区外路径：${target}`);
  }
  return target;
}

function removeTarget(path) {
  const target = assertInsideProject(path);
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    return target;
  }
  return null;
}

const targets = [
  join(dataDirectory, "model-mayhem.sqlite"),
  join(dataDirectory, "model-mayhem.sqlite-wal"),
  join(dataDirectory, "model-mayhem.sqlite-shm"),
  join(dataDirectory, "model-mayhem.sqlite.pending-restore"),
  join(dataDirectory, "debug-create.sqlite"),
  join(dataDirectory, "codex-current-match.json"),
  join(dataDirectory, "installation"),
  join(dataDirectory, "agent-runtime"),
  join(dataDirectory, "logs"),
  join(projectRoot, ".runtime"),
  join(projectRoot, "apps", "web", "dist"),
  join(projectRoot, "node_modules", ".vite"),
  join(projectRoot, "data", "agent-faction-server.err.log"),
  join(projectRoot, "data", "agent-faction-server.out.log"),
  join(projectRoot, "data", "server-dev.err.log"),
  join(projectRoot, "data", "server-dev.out.log"),
  join(projectRoot, "data", "self-play.err.log"),
  join(projectRoot, "data", "self-play.out.log"),
  join(projectRoot, "data", "server.err.log"),
  join(projectRoot, "data", "server.out.log"),
  join(projectRoot, "data", "web.err.log"),
  join(projectRoot, "data", "web.out.log"),
];

const removed = targets.map(removeTarget).filter(Boolean);
console.log(`发行重置完成，共清理 ${removed.length} 个活动路径。`);
console.log(`玩家数据备份保留在：${join(dataDirectory, "backups")}`);
