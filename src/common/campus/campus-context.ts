import { AsyncLocalStorage } from 'async_hooks';
import { Campus } from '@prisma/client';

/**
 * Per-request school (campus) context. Set by `CampusContextInterceptor` for authenticated requests and read by
 * the Prisma campus middleware, which filters every query to this campus. No store (public routes, login,
 * cron jobs, seed/scripts) = unscoped.
 */
export interface CampusStore {
  campus?: Campus;
  /** Logged-in user — their own User row stays visible even when an all-schools admin works in the other school. */
  userId?: string;
  /** Temporarily bypass campus scoping (see `runUnscoped`). */
  unscoped?: boolean;
}

export const campusStorage = new AsyncLocalStorage<CampusStore>();

export function currentCampus(): Campus | undefined {
  const s = campusStorage.getStore();
  return s && !s.unscoped ? s.campus : undefined;
}

/**
 * Runs `fn` without campus scoping (e.g. combined totals for the main admin).
 * Always `await` Prisma calls inside `fn`: Prisma queries are lazy and run in the context where they are awaited.
 */
export function runUnscoped<T>(fn: () => Promise<T>): Promise<T> {
  const s = campusStorage.getStore() ?? {};
  return campusStorage.run({ ...s, unscoped: true }, async () => await fn());
}

/** Runs `fn` scoped to one campus (main admin acting on a specific school). */
export function runInCampus<T>(campus: Campus, fn: () => Promise<T>): Promise<T> {
  const s = campusStorage.getStore() ?? {};
  return campusStorage.run({ ...s, campus, unscoped: false }, async () => await fn());
}
