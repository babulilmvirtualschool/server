import { Prisma } from '@prisma/client';

/**
 * Every `User` column except `passwordHash`. Use `user: { select: publicUserSelect }`
 * instead of `user: true` whenever a user record can end up in an API response.
 */
export const publicUserSelect = {
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
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;
