import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TokensService } from './tokens.service';
import { LoginDto } from './dto/login.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/password.dto';
import { UpdateOwnProfileDto } from './dto/update-own-profile.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
  ) {}

  async login(dto: LoginDto, meta: { userAgent?: string; ipAddress?: string }) {
    if (!dto.email && !dto.username) {
      throw new BadRequestException('Email or username is required');
    }
    const user = await this.prisma.user.findFirst({
      where: dto.email ? { email: dto.email } : { username: dto.username },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = await this.tokens.issueAccessToken(user.id, user.role);
    const refreshToken = await this.tokens.issueRefreshToken(user.id, meta);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarKey: user.avatarKey,
      },
    };
  }

  async refresh(rawToken: string, meta: { userAgent?: string; ipAddress?: string }) {
    const rotated = await this.tokens.rotateRefreshToken(rawToken, meta);
    if (!rotated) throw new UnauthorizedException('Invalid refresh token');
    const accessToken = await this.tokens.issueAccessToken(
      rotated.user.id,
      rotated.user.role,
    );
    return { accessToken, refreshToken: rotated.refreshToken };
  }

  async logout(rawToken?: string) {
    if (rawToken) await this.tokens.revokeRefreshToken(rawToken);
    return { success: true };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    // Always return success to avoid account enumeration.
    if (!user) return { success: true };

    const raw = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.tokens.hashToken(raw),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    // TODO: send email with link containing `raw`. For now we return it in
    // non-production responses so the integrator can wire an email provider.
    if (process.env.NODE_ENV !== 'production') {
      return { success: true, debugToken: raw };
    }
    return { success: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = this.tokens.hashToken(dto.token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { success: true };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Current password is incorrect');
    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    await this.tokens.revokeAllForUser(userId);
    return { success: true };
  }

  async updateOwnProfile(userId: string, dto: UpdateOwnProfileDto) {
    const existing = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!existing) throw new UnauthorizedException();

    const email =
      dto.email !== undefined
        ? dto.email === null || String(dto.email).trim() === ''
          ? null
          : String(dto.email).trim()
        : undefined;
    const username =
      dto.username !== undefined
        ? dto.username === null || String(dto.username).trim() === ''
          ? null
          : String(dto.username).trim()
        : undefined;
    const phone =
      dto.phone !== undefined
        ? dto.phone === null || String(dto.phone).trim() === ''
          ? null
          : String(dto.phone).trim()
        : undefined;

    if (email !== undefined && email !== existing.email && email !== null) {
      const clash = await this.prisma.user.findFirst({
        where: { email, NOT: { id: userId } },
      });
      if (clash) throw new BadRequestException('Email already in use');
    }
    if (username !== undefined && username !== existing.username && username !== null) {
      const clash = await this.prisma.user.findFirst({
        where: { username, NOT: { id: userId } },
      });
      if (clash) throw new BadRequestException('Username already in use');
    }
    if (phone !== undefined && phone !== existing.phone && phone !== null) {
      const clash = await this.prisma.user.findFirst({
        where: { phone, NOT: { id: userId } },
      });
      if (clash) throw new BadRequestException('Phone number already in use');
    }

    if (
      dto.firstName !== undefined &&
      (!dto.firstName || !String(dto.firstName).trim())
    ) {
      throw new BadRequestException('First name cannot be empty');
    }
    if (
      dto.lastName !== undefined &&
      (!dto.lastName || !String(dto.lastName).trim())
    ) {
      throw new BadRequestException('Last name cannot be empty');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined
          ? { firstName: String(dto.firstName).trim() }
          : {}),
        ...(dto.lastName !== undefined ? { lastName: String(dto.lastName).trim() } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(username !== undefined ? { username } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(dto.gender !== undefined
          ? { gender: dto.gender }
          : {}),
        ...(dto.avatarKey !== undefined ? { avatarKey: dto.avatarKey || null } : {}),
        ...(dto.dateOfBirth !== undefined
          ? {
              dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
            }
          : {}),
      },
    });

    return this.me(userId);
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        phone: true,
        role: true,
        firstName: true,
        lastName: true,
        avatarKey: true,
        gender: true,
        dateOfBirth: true,
        createdAt: true,
        adminProfile: true,
        teacherProfile: true,
        studentProfile: true,
        parentProfile: true,
      },
    });
  }
}
