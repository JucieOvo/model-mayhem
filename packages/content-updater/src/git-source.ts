/**
 * 真实 Git 内容来源。
 *
 * 作者：JucieOvo
 *
 * 只通过 execFile 调用 Git，不拼接 Shell 命令。远端只检出 content 目录，源代码、
 * 数据库迁移和发行脚本都不会进入内容暂存区。
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface GitContentSourceOptions {
  readonly repository: string;
  readonly branch: string;
  readonly gitExecutable?: string;
  readonly contentPath?: string;
}

export interface StagedGitContent {
  readonly commit: string;
  readonly contentDirectory: string;
}

function runGit(executable: string, args: readonly string[], workingDirectory?: string): string {
  try {
    return execFileSync(executable, args, {
      ...(workingDirectory === undefined ? {} : { cwd: workingDirectory }),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Git 命令失败：${args[0] ?? "unknown"}；${message}`);
  }
}

/** 只允许相对仓库根目录的内容目录。 */
export function normalizeContentPath(value: string): string {
  const normalized = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");
  if (
    normalized.length === 0 ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized === ".."
  ) {
    throw new Error(`内容路径必须是仓库内的相对目录：${value}`);
  }
  return normalized;
}

export class GitContentSource {
  private readonly gitExecutable: string;
  private readonly contentPath: string;

  constructor(private readonly options: GitContentSourceOptions) {
    this.gitExecutable = options.gitExecutable ?? "git";
    this.contentPath = normalizeContentPath(options.contentPath ?? "content");
  }

  /** 读取目标分支当前提交，不下载完整历史。 */
  checkRemoteHead(): string {
    const output = runGit(this.gitExecutable, [
      "ls-remote",
      this.options.repository,
      `refs/heads/${this.options.branch}`,
    ]);
    const commit = output.split(/\s+/)[0] ?? "";
    if (!/^[a-f0-9]{40,64}$/i.test(commit)) {
      throw new Error(`远端分支不存在或没有有效提交：${this.options.branch}`);
    }
    return commit;
  }

  /** 将指定提交中的内容目录检出到独立暂存目录。 */
  stageCommit(commit: string, destination: string): StagedGitContent {
    mkdirSync(destination, { recursive: true });
    runGit(this.gitExecutable, ["init", "--quiet"], destination);
    runGit(this.gitExecutable, ["remote", "add", "origin", this.options.repository], destination);
    runGit(this.gitExecutable, ["fetch", "--depth=1", "origin", commit], destination);
    runGit(this.gitExecutable, ["sparse-checkout", "init", "--cone"], destination);
    runGit(this.gitExecutable, ["sparse-checkout", "set", this.contentPath], destination);
    runGit(this.gitExecutable, ["checkout", "--quiet", "--detach", commit], destination);
    const checkedOutCommit = runGit(this.gitExecutable, ["rev-parse", "HEAD"], destination);
    if (checkedOutCommit !== commit) {
      throw new Error(`Git 暂存提交不一致：期望 ${commit}，实际 ${checkedOutCommit}`);
    }
    return {
      commit,
      contentDirectory: join(destination, this.contentPath),
    };
  }
}
