import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { StaffAlertDto } from './dto/staff-alert.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(user: AuthUser, onlyUnread = false) {
    return this.prisma.notification.findMany({
      where: {
        userId: user.id,
        ...(onlyUnread ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async markRead(user: AuthUser, id: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId: user.id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(user: AuthUser) {
    return this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  /** Internal helper for other services to push a notification. */
  async push(
    userId: string,
    type: string,
    title: string,
    body?: string,
    data?: Record<string, unknown>,
  ) {
    return this.prisma.notification.create({
      data: { userId, type, title, body, data: data as any },
    });
  }

  /** Admin — put an emergency / security alert or notice in the portal of every active teacher and / or non-teaching staff member. */
  async alertStaff(dto: StaffAlertDto) {
    const roles = dto.audience === 'TEACHERS' ? ['TEACHER'] : dto.audience === 'NON_TEACHING' ? ['STAFF'] : ['TEACHER', 'STAFF'];
    const users = await this.prisma.user.findMany({ where: { isActive: true, role: { in: roles as any } }, select: { id: true } });
    const title = dto.title?.trim() || (dto.kind === 'EMERGENCY' ? 'Emergency alert' : dto.kind === 'SECURITY' ? 'Security alert' : 'Notice');
    if (users.length) {
      await this.prisma.notification.createMany({
        data: users.map((u) => ({ userId: u.id, type: `${dto.kind}_ALERT`, title, body: dto.body.trim(), data: { audience: dto.audience } })),
      });
    }
    return { sent: users.length };
  }
}
