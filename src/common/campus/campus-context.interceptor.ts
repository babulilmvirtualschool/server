import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Campus, Role } from '@prisma/client';
import { Observable } from 'rxjs';
import type { AuthUser } from '../decorators/current-user.decorator';
import { campusStorage, CampusStore } from './campus-context';

export const CAMPUS_HEADER = 'x-campus';

/**
 * Runs each authenticated request inside its school context: the user's own campus, or — for an admin with
 * access to both schools — the school chosen in the portal (`X-Campus: ONLINE | PHYSICAL`).
 */
@Injectable()
export class CampusContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const user: AuthUser | undefined = req?.user;
    let store: CampusStore = {};
    if (user?.campus) {
      let campus: Campus = user.campus;
      if (user.role === Role.ADMIN && user.allCampuses) {
        const h = String(req.headers?.[CAMPUS_HEADER] ?? '').toUpperCase();
        if (h === Campus.ONLINE || h === Campus.PHYSICAL) campus = h;
      }
      store = { campus, userId: user.id };
    }
    return new Observable((subscriber) =>
      campusStorage.run(store, () => next.handle().subscribe(subscriber)),
    );
  }
}
