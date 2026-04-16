/**
 * 輕量 logger — 純 stdout/stderr 輸出，Docker 友好。
 *
 * 格式（單行 JSON）：
 *   {"time":"2026-04-16T14:00:00.000Z","level":"info","msg":"...","...extra fields"}
 *
 * 使用 LOG_LEVEL 環境變數控制最低層級（預設 "info"）：
 *   LOG_LEVEL=debug  → 輸出 debug / info / warn / error
 *   LOG_LEVEL=info   → 輸出 info / warn / error（預設）
 *   LOG_LEVEL=warn   → 輸出 warn / error
 *   LOG_LEVEL=error  → 只輸出 error
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

function parseLogLevel(raw: string | undefined): LogLevel {
  const normalized = raw?.toLowerCase().trim();
  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }
  return "info";
}

const minLevel = parseLogLevel(process.env.LOG_LEVEL);
const minRank = LEVEL_RANK[minLevel];

type LogFields = Record<string, unknown>;

function write(level: LogLevel, msg: string, fields?: LogFields): void {
  if (LEVEL_RANK[level] < minRank) return;

  const entry: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    msg,
    ...fields
  };

  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info:  (msg: string, fields?: LogFields) => write("info",  msg, fields),
  warn:  (msg: string, fields?: LogFields) => write("warn",  msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),

  /** 序列化 Error 物件（含 stack）成可 log 的 fields */
  errFields(err: unknown): LogFields {
    if (err instanceof Error) {
      return {
        err_message: err.message,
        err_name: err.name,
        err_stack: err.stack
      };
    }
    return { err_raw: String(err) };
  }
};
