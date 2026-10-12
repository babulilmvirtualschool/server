import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Campus, Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  role: Role;
  email: string | null;
  username: string | null;
  campus: Campus;
  /** ADMIN only: main admin who can switch between both schools. */
  allCampuses: boolean;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | AuthUser[keyof AuthUser] => {
    const request = ctx.switchToHttp().getRequest();
    const user: AuthUser = request.user;
    return data ? user?.[data] : user;
  },
);
