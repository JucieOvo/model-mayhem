/**
 * 本地分类日志与诊断缓冲。
 *
 * 作者：JucieOvo
 *
 * 日志写入用户数据目录，不向外发送。pino 负责结构化字段，写入流按 category
 * 分流到不同文件，并执行轮转和二次脱敏。
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import pino from "pino";
import { redactText, safeError } from "./redaction";

const LOG_CATEGORIES = [
  "launcher",
  "update",
  "server",
  "match",
  "agent",
  "tutorial",
  "sandbox",
  "client",
] as const;

export type LogCategory = (typeof LOG_CATEGORIES)[number];

export interface LocalLoggingOptions {
  readonly directory: string;
  readonly level: string;
  readonly maxBytes: number;
  readonly maxFiles: number;
}

export interface LocalLogger {
  readonly logger: pino.Logger;
  getRecent(category?: LogCategory, limit?: number): readonly string[];
  getDirectory(): string;
  close(): void;
}

class RotatingLogFile {
  private size = 0;

  constructor(
    private readonly directory: string,
    private readonly category: LogCategory,
    private readonly maxBytes: number,
    private readonly maxFiles: number,
  ) {
    mkdirSync(directory, { recursive: true });
    this.size = existsSync(this.path) ? statSync(this.path).size : 0;
  }

  private get path(): string {
    return join(this.directory, `${this.category}.log`);
  }

  append(line: string): void {
    const bytes = Buffer.byteLength(line, "utf8");
    if (this.size + bytes > this.maxBytes && this.size > 0) {
      this.rotate();
    }
    appendFileSync(this.path, line, "utf8");
    this.size += bytes;
  }

  private rotate(): void {
    const oldest = join(this.directory, `${this.category}.${this.maxFiles}.log`);
    rmSync(oldest, { force: true });
    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      const source = join(this.directory, `${this.category}.${index}.log`);
      if (!existsSync(source)) {
        continue;
      }
      renameSync(source, join(this.directory, `${this.category}.${index + 1}.log`));
    }
    if (existsSync(this.path)) {
      renameSync(this.path, join(this.directory, `${this.category}.1.log`));
    }
    this.size = 0;
  }
}

function categoryOf(record: Record<string, unknown>): LogCategory {
  const value = record.category;
  return typeof value === "string" && LOG_CATEGORIES.includes(value as LogCategory)
    ? (value as LogCategory)
    : "server";
}

/** 创建真实本地日志器和有限内存诊断缓冲。 */
export function createLocalLogger(options: LocalLoggingOptions): LocalLogger {
  const writers = new Map(
    LOG_CATEGORIES.map((category) => [
      category,
      new RotatingLogFile(options.directory, category, options.maxBytes, options.maxFiles),
    ]),
  );
  const recent: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const line = redactText(chunk.toString());
      let record: Record<string, unknown> = {};
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        record = { category: "server" };
      }
      const category = categoryOf(record);
      writers.get(category)?.append(line);
      recent.push(line);
      if (recent.length > 2_000) {
        recent.splice(0, recent.length - 2_000);
      }
      callback();
    },
  });
  const logger = pino(
    {
      level: options.level,
      redact: {
        paths: [
          "apiKey",
          "authorization",
          "seatToken",
          "accessToken",
          "password",
          "secret",
          "*.apiKey",
          "*.authorization",
          "*.seatToken",
          "*.accessToken",
          "*.password",
          "*.secret",
          "req.headers.authorization",
        ],
        censor: "[REDACTED_SECRET]",
      },
      base: null,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    stream,
  );
  return {
    logger,
    getRecent(category, limit = 200) {
      const filtered = category
        ? recent.filter((line) => {
            try {
              return categoryOf(JSON.parse(line) as Record<string, unknown>) === category;
            } catch {
              return false;
            }
          })
        : recent;
      return filtered.slice(-Math.max(0, limit));
    },
    getDirectory() {
      return options.directory;
    },
    close() {
      stream.end();
    },
  };
}

export function errorDetails(error: unknown): ReturnType<typeof safeError> {
  return safeError(error);
}
