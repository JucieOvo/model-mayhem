/**
 * Pi 对战 Agent 的隔离运行目录。
 *
 * 作者：JucieOvo
 *
 * 对战 Agent 的全部可写路径都限制在应用数据目录下的 agent-runtime 子目录。
 * 该模块不会使用用户主目录、系统临时目录或项目源码目录。
 */

import { mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export interface PiBattleRuntimeOptions {
  readonly rootDirectory: string;
  readonly allowedRootDirectory: string;
}

export interface PiBattleRuntime {
  readonly rootDirectory: string;
  readonly workspaceDirectory: string;
  readonly sessionsDirectory: string;
  readonly cacheDirectory: string;
  readonly temporaryDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
}

function assertContained(rootDirectory: string, targetDirectory: string): void {
  const relativePath = relative(rootDirectory, targetDirectory);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`对战 Agent 运行目录必须位于应用数据子目录内：${targetDirectory}`);
  }
}

function copyEnvironmentValue(
  environment: Record<string, string>,
  source: NodeJS.ProcessEnv,
  key: string,
): void {
  const value = source[key];
  if (value !== undefined && value.length > 0) {
    environment[key] = value;
  }
}

/** 创建并验证独立的 Agent 运行目录。 */
export function createPiBattleRuntime(options: PiBattleRuntimeOptions): PiBattleRuntime {
  const allowedRoot = resolve(options.allowedRootDirectory);
  const requestedRoot = resolve(options.rootDirectory);
  mkdirSync(allowedRoot, { recursive: true });
  const canonicalAllowedRoot = realpathSync(allowedRoot);
  const requestedRootCandidate = resolve(
    canonicalAllowedRoot,
    relative(allowedRoot, requestedRoot),
  );
  mkdirSync(requestedRootCandidate, { recursive: true });
  const canonicalRequestedRoot = realpathSync(requestedRootCandidate);
  assertContained(canonicalAllowedRoot, canonicalRequestedRoot);

  const workspaceDirectory = join(canonicalRequestedRoot, "workspace");
  const sessionsDirectory = join(canonicalRequestedRoot, "sessions");
  const cacheDirectory = join(canonicalRequestedRoot, "cache");
  const temporaryDirectory = join(canonicalRequestedRoot, "tmp");
  const appDataDirectory = join(canonicalRequestedRoot, "appdata");
  const localAppDataDirectory = join(canonicalRequestedRoot, "localappdata");
  const configDirectory = join(canonicalRequestedRoot, "config");
  const dataDirectory = join(canonicalRequestedRoot, "data");
  for (const directory of [
    canonicalRequestedRoot,
    workspaceDirectory,
    sessionsDirectory,
    cacheDirectory,
    temporaryDirectory,
    appDataDirectory,
    localAppDataDirectory,
    configDirectory,
    dataDirectory,
  ]) {
    mkdirSync(directory, { recursive: true });
  }

  const environment: Record<string, string> = {
    HOME: canonicalRequestedRoot,
    USERPROFILE: canonicalRequestedRoot,
    APPDATA: appDataDirectory,
    LOCALAPPDATA: localAppDataDirectory,
    XDG_CONFIG_HOME: configDirectory,
    XDG_CACHE_HOME: cacheDirectory,
    XDG_DATA_HOME: dataDirectory,
    TMPDIR: temporaryDirectory,
    TEMP: temporaryDirectory,
    TMP: temporaryDirectory,
    PWD: canonicalRequestedRoot,
    PI_AGENT_RUNTIME_DIRECTORY: canonicalRequestedRoot,
  };
  for (const key of [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "DEEPSEEK_API_KEY",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "NODE_EXTRA_CA_CERTS",
  ]) {
    copyEnvironmentValue(environment, process.env, key);
  }

  return {
    rootDirectory: canonicalRequestedRoot,
    workspaceDirectory,
    sessionsDirectory,
    cacheDirectory,
    temporaryDirectory,
    environment,
  };
}
