import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiEnvelope<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

/** Fields that must never leave the API, even if a query forgets a safe `select`. */
const SENSITIVE_KEYS = new Set(['passwordHash', 'tokenHash']);

/** Returns a copy of plain objects/arrays without sensitive keys; Dates and class instances pass through. */
export function stripSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (value === null || typeof value !== 'object') return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!SENSITIVE_KEYS.has(key)) out[key] = stripSensitive(v);
  }
  return out;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiEnvelope<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiEnvelope<T>> {
    return next.handle().pipe(
      map((payload: any) => {
        if (
          payload &&
          typeof payload === 'object' &&
          'data' in payload &&
          'meta' in payload
        ) {
          return {
            success: true,
            data: stripSensitive(payload.data) as T,
            meta: stripSensitive(payload.meta) as Record<string, unknown>,
          };
        }
        return { success: true, data: stripSensitive(payload) as T };
      }),
    );
  }
}
