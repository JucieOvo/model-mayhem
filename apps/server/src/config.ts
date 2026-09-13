/**
 * 服务端运行配置。
 *
 * 作者：JucieOvo
 *
 * 配置只从环境变量和显式参数读取。没有 DeepSeek 密钥时服务仍可查询和推进人类
 * 回合，但默认 Pi Agent 会明确报告不可用，不会伪造自动行动。
 */

import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { UpdateChannel } from "@modelmayhem/contracts";
import { DEFAULT_CONTENT_ROOT } from "@modelmayhem/model-mayhem-content";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDirectory, "..", "..", "..");
const DEFAULT_UPDATE_REPOSITORY = "https://github.com/JucieOvo/model-mayhem.git";

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly dataDirectory: string;
  readonly agentRuntimeDirectory: string;
  readonly databasePath: string;
  readonly contentDirectory: string;
  readonly webDirectory: string;
  readonly profileId: string;
  readonly logLevel: string;
  readonly logDirectory: string;
  readonly logMaxBytes: number;
  readonly logMaxFiles: number;
  readonly piAgentPromptTimeoutMs: number;
  readonly piAgentToolTimeoutMs: number;
  readonly updateRepository?: string;
  readonly updateContentBranch: string;
  readonly updateBalanceBranch: string;
  readonly updateChannel: UpdateChannel;
  readonly updateCheckOnStart: boolean;
  readonly updateAutoInstall: boolean;
  readonly controlToken?: string;
  readonly gitExecutable: string;
  readonly updateContentRoot: string;
  readonly updateBalanceRoot: string;
  readonly updateContentPaths: readonly string[];
  readonly updateBalancePaths: readonly string[];
  readonly sandboxEnabled: boolean;
  readonly sandboxProfileId: string;
  readonly devApiEnabled: boolean;
  readonly devRemoteEnabled: boolean;
  readonly corsOrigins: readonly string[];
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.length === 0) {
    return 3210;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`PORT 必须是 1 到 65535 的整数，收到：${value}`);
  }
  return parsed;
}

function parsePromptTimeout(value: string | undefined): number {
  if (value === undefined || value.length === 0) {
    return 180_000;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 600_000) {
    throw new Error(`PI_AGENT_PROMPT_TIMEOUT_MS 必须是 1000 到 600000 的整数，收到：${value}`);
  }
  return parsed;
}

function parseToolTimeout(value: string | undefined): number {
  if (value === undefined || value.length === 0) {
    return 15_000;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 120_000) {
    throw new Error(`PI_AGENT_TOOL_TIMEOUT_MS 必须是 100 到 120000 的整数，收到：${value}`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.length === 0) {
    return fallback;
  }
  if (value === "1" || value.toLowerCase() === "true") {
    return true;
  }
  if (value === "0" || value.toLowerCase() === "false") {
    return false;
  }
  throw new Error(`布尔环境变量值无效：${value}`);
}

function parsePositiveInteger(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value.length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} 必须是正整数，收到：${value}`);
  }
  return parsed;
}

function parseControlToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  if (!token) {
    return undefined;
  }
  if (token.length < 32) {
    throw new Error("MODELMAYHEM_CONTROL_TOKEN 至少需要 32 个字符");
  }
  return token;
}

function resolveRepositoryPath(value: string | undefined, fallback: string): string {
  const candidate = value === undefined || value.length === 0 ? fallback : value;
  return isAbsolute(candidate) ? resolve(candidate) : resolve(projectRoot, candidate);
}

function defaultUpdateBranches(channel: UpdateChannel): {
  readonly content: string;
  readonly balance: string;
} {
  if (channel === "stable") {
    return {
      content: "content/stable",
      balance: "balance/stable",
    };
  }
  if (channel === "preview") {
    return {
      content: "content/next",
      balance: "balance/next",
    };
  }
  return {
    content: "main",
    balance: "main",
  };
}

function parsePathList(
  value: string | undefined,
  fallback: readonly string[],
  label: string,
): readonly string[] {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const paths = value
    .split(",")
    .map((entry) =>
      entry
        .trim()
        .replaceAll("\\", "/")
        .replace(/^\/+|\/+$/g, ""),
    )
    .filter(Boolean);
  if (paths.length === 0) {
    throw new Error(`${label} 至少需要一个相对路径`);
  }
  for (const path of paths) {
    if (path === "." || path === ".." || path.startsWith("../") || path.includes("/../")) {
      throw new Error(`${label} 只能是仓库内的相对路径：${path}`);
    }
    if (path === "manifest" || path.startsWith("manifest/")) {
      throw new Error(`${label} 不能覆盖来源清单目录`);
    }
  }
  return [...new Set(paths)];
}

/** 从当前进程环境读取真实服务配置。 */
export function loadServerConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dataDirectory = resolveRepositoryPath(
    environment.MODELMAYHEM_DATA_DIR,
    join(projectRoot, "data"),
  );
  const profileId = environment.MODELMAYHEM_PROFILE_ID ?? "local";
  const updateChannel = (environment.MODELMAYHEM_UPDATE_CHANNEL ?? "stable") as UpdateChannel;
  if (!["stable", "preview", "custom"].includes(updateChannel)) {
    throw new Error(`MODELMAYHEM_UPDATE_CHANNEL 无效：${updateChannel}`);
  }
  const defaultBranches = defaultUpdateBranches(updateChannel);
  const legacyUpdateBranch = environment.MODELMAYHEM_UPDATE_BRANCH?.trim();
  const updateRepository =
    environment.MODELMAYHEM_UPDATE_REPOSITORY === undefined
      ? DEFAULT_UPDATE_REPOSITORY
      : environment.MODELMAYHEM_UPDATE_REPOSITORY.trim();
  const controlToken = parseControlToken(environment.MODELMAYHEM_CONTROL_TOKEN);
  const legacyContentRoot = environment.MODELMAYHEM_UPDATE_CONTENT_PATH?.trim();
  return {
    host: environment.HOST ?? "127.0.0.1",
    port: parsePort(environment.PORT),
    dataDirectory,
    agentRuntimeDirectory: resolveRepositoryPath(
      environment.MODELMAYHEM_AGENT_RUNTIME_DIR,
      join(dataDirectory, "agent-runtime"),
    ),
    databasePath: resolveRepositoryPath(
      environment.MODELMAYHEM_DATABASE_PATH,
      join(dataDirectory, "model-mayhem.sqlite"),
    ),
    contentDirectory: resolveRepositoryPath(
      environment.MODELMAYHEM_CONTENT_DIR,
      DEFAULT_CONTENT_ROOT,
    ),
    webDirectory: resolveRepositoryPath(
      environment.MODELMAYHEM_WEB_DIR,
      join(projectRoot, "apps", "web", "dist"),
    ),
    profileId,
    logLevel: environment.LOG_LEVEL ?? "info",
    logDirectory: resolveRepositoryPath(
      environment.MODELMAYHEM_LOG_DIR,
      join(dataDirectory, "logs"),
    ),
    logMaxBytes: parsePositiveInteger(
      environment.MODELMAYHEM_LOG_MAX_BYTES,
      10 * 1024 * 1024,
      "MODELMAYHEM_LOG_MAX_BYTES",
    ),
    logMaxFiles: parsePositiveInteger(
      environment.MODELMAYHEM_LOG_MAX_FILES,
      7,
      "MODELMAYHEM_LOG_MAX_FILES",
    ),
    piAgentPromptTimeoutMs: parsePromptTimeout(environment.PI_AGENT_PROMPT_TIMEOUT_MS),
    piAgentToolTimeoutMs: parseToolTimeout(environment.PI_AGENT_TOOL_TIMEOUT_MS),
    ...(updateRepository ? { updateRepository } : {}),
    updateContentBranch:
      environment.MODELMAYHEM_CONTENT_BRANCH?.trim() ||
      legacyUpdateBranch ||
      defaultBranches.content,
    updateBalanceBranch:
      environment.MODELMAYHEM_BALANCE_BRANCH?.trim() ||
      legacyUpdateBranch ||
      defaultBranches.balance,
    updateChannel,
    updateCheckOnStart: parseBoolean(environment.MODELMAYHEM_UPDATE_CHECK_ON_START, true),
    updateAutoInstall: parseBoolean(environment.MODELMAYHEM_UPDATE_AUTO_INSTALL, false),
    ...(controlToken ? { controlToken } : {}),
    gitExecutable: environment.MODELMAYHEM_GIT_EXECUTABLE ?? "git",
    updateContentRoot:
      environment.MODELMAYHEM_CONTENT_ROOT?.trim() || legacyContentRoot || "content",
    updateBalanceRoot:
      environment.MODELMAYHEM_BALANCE_ROOT?.trim() || legacyContentRoot || "content",
    updateContentPaths: parsePathList(
      environment.MODELMAYHEM_CONTENT_PATHS,
      ["presentation", "thumbnails", "questions"],
      "MODELMAYHEM_CONTENT_PATHS",
    ),
    updateBalancePaths: parsePathList(
      environment.MODELMAYHEM_BALANCE_PATHS,
      ["cards", "balance", "decks", "research", "eras", "doctrines"],
      "MODELMAYHEM_BALANCE_PATHS",
    ),
    sandboxEnabled: parseBoolean(environment.MODELMAYHEM_SANDBOX, false),
    sandboxProfileId: environment.MODELMAYHEM_SANDBOX_PROFILE_ID ?? `${profileId}-sandbox`,
    devApiEnabled: parseBoolean(environment.MODELMAYHEM_DEV_API, false),
    devRemoteEnabled: parseBoolean(environment.MODELMAYHEM_DEV_REMOTE, false),
    corsOrigins: (
      environment.MODELMAYHEM_CORS_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173"
    )
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  };
}
