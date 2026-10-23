import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { runInCampus } from '../../common/campus/campus-context';
import { defaulterCache } from './fee-defaulter.cache';
import { FeeReportsService } from './fee-reports.service';

/** Routes a blocked student / parent can still use: sign-in and session, and their own fee pages. */
const ALLOWED = [/\/auth\//, /\/me\/fee-challans$/, /\/me\/fee-status$/, /\/health/];

const TTL_MS = 60_000;

/**
 * PDF1 5.2 "Block Parent & Student Portal for Defaulter": with the setting on, a student / parent whose challan is still unpaid
 * `defaulterGraceDays` after its due date gets 403 `FEE_DEFAULTER` on every portal route except sign-in and the fee pages.
 */
@Injectable()
export class FeeDefaulterInterceptor implements NestInterceptor {
  constructor(private readonly reports: FeeReportsService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest();
    const user: AuthUser | undefined = req?.user;
    if (!user?.campus || (user.role !== 'STUDENT' && user.role !== 'PARENT')) return next.handle();
    const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
    if (ALLOWED.some((re) => re.test(path))) return next.handle();
    let hit = defaulterCache.get(user.id);
    if (!hit || Date.now() - hit.at > TTL_MS) {
      const status = await runInCampus(user.campus, () => this.reports.feeStatus(user));
      hit = { blocked: status.blocked, at: Date.now() };
      defaulterCache.set(user.id, hit);
    }
    if (hit.blocked) {
      throw new ForbiddenException({
        message: 'Your portal is blocked because of unpaid fee. Please clear the fee to continue.',
        code: 'FEE_DEFAULTER',
      });
    }
    return next.handle();
  }
}
