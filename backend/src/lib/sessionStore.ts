import session from "express-session";
import type { SessionData } from "express-session";
import { repo } from "../db.js";

function resolveSessionExpiry(sessionData: SessionData): string {
  const expires = sessionData.cookie?.expires;

  if (expires instanceof Date) {
    return expires.toISOString();
  }

  if (typeof expires === "string") {
    return new Date(expires).toISOString();
  }

  if (typeof sessionData.cookie?.originalMaxAge === "number") {
    return new Date(Date.now() + sessionData.cookie.originalMaxAge).toISOString();
  }

  return new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
}

class SqliteSessionStore extends session.Store {
  override get(sid: string, callback: (err: unknown, session?: SessionData | null) => void): void {
    try {
      callback(null, repo.getSession(sid));
    } catch (error) {
      callback(error);
    }
  }

  override set(sid: string, sessionData: SessionData, callback?: (err?: unknown) => void): void {
    try {
      repo.persistSession(sid, JSON.stringify(sessionData), resolveSessionExpiry(sessionData));
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  override destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      repo.deleteSession(sid);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }

  override touch(sid: string, sessionData: SessionData, callback?: () => void): void {
    try {
      repo.persistSession(sid, JSON.stringify(sessionData), resolveSessionExpiry(sessionData));
      callback?.();
    } catch (error) {
      (callback as ((err?: unknown) => void) | undefined)?.(error);
    }
  }
}

export function createSqliteSessionStore() {
  return new SqliteSessionStore();
}

export function cleanupExpiredSessions(now = new Date().toISOString()) {
  return repo.deleteExpiredSessions(now);
}

export function startSessionCleanup(intervalMs: number) {
  const runCleanup = () => {
    try {
      cleanupExpiredSessions();
    } catch (error) {
      console.error("Failed to cleanup expired sessions", error);
    }
  };

  runCleanup();

  const timer = setInterval(runCleanup, intervalMs);
  timer.unref?.();

  return {
    stop() {
      clearInterval(timer);
    }
  };
}

export const sessionStore = createSqliteSessionStore();
