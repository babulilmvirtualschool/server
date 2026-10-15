import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  AdmissionApplicationStatus,
  Campus,
  Gender,
  ParentRelation,
  Prisma,
  Role,
  TeacherApplicationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { MediaService } from '../media/media.service';
import { PasswordVault } from '../../common/utils/password-vault';
import { DischargeStudentsDto, ListDischargedDto, ReadmitStudentDto } from './dto/student-lifecycle.dto';
import {
  CreateAdminDto,
  CreateParentDto,
  CreateStudentDto,
  CreateTeacherDto,
  ParentChildLinkDto,
} from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ExportStudentsDto, ListUsersDto } from './dto/list-users.dto';
import { CreateStudentWithParentsDto } from './dto/create-student-with-parents.dto';
import { UpdateStudentRecordDto } from './dto/update-student-record.dto';

type StudentRecordFields = {
  appliedClass: string | null;
  curriculum: string | null;
  preferredShift: string | null;
  bFormNo: string | null;
  guardianName: string | null;
  guardianRelation: string | null;
  guardianPhone: string | null;
  religion: string | null;
};
import { getSkipTake, paginate } from '../../common/pagination/pagination.dto';
import { currentCampus, runUnscoped } from '../../common/campus/campus-context';
import {
  baseUsernameFromNames,
  isValidUsernameFormat,
} from '../../common/utils/username.util';

@Injectable()
export class UsersService {
  private readonly vault: PasswordVault;

  constructor(
    private readonly prisma: PrismaService,
    cfg: AppConfigService,
    private readonly media: MediaService,
  ) {
    this.vault = new PasswordVault(cfg.jwtRefreshSecret);
  }

  private async hashPassword(raw: string) {
    return bcrypt.hash(raw, 12);
  }

  /** Password hash + the admin-viewable encrypted copy (every password an admin issues). */
  private async credentials(raw: string) {
    return { passwordHash: await this.hashPassword(raw), issuedPasswordEnc: this.vault.seal(raw) };
  }

  /** Admin: login details incl. the issued password while the user hasn't set their own. */
  async getLoginDetails(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, email: true, role: true, firstName: true, lastName: true, isActive: true, issuedPasswordEnc: true },
    });
    if (!u) throw new NotFoundException('User not found');
    const password = this.vault.open(u.issuedPasswordEnc);
    const { issuedPasswordEnc: _enc, ...rest } = u;
    return { ...rest, password, passwordSetByUser: !u.issuedPasswordEnc };
  }

  /** Set or remove a user's photo (the key must be the actor's own finished photo upload). */
  async setPhoto(userId: string, avatarKey: string | null, actorId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!u) throw new NotFoundException('User not found');
    if (avatarKey) await this.media.assertOwnPhoto(avatarKey, actorId);
    await this.prisma.user.update({ where: { id: userId }, data: { avatarKey } });
    return { avatarKey };
  }

  private userSelect(): Prisma.UserSelect {
    return {
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
      adminProfile: true,
      teacherProfile: true,
      studentProfile: true,
      parentProfile: {
        select: {
          id: true,
          occupation: true,
          cnic: true,
          address: true,
          _count: { select: { children: true } },
        },
      },
    };
  }

  /**
   * Narrow columns for GET /users lists — avoids pulling full profile blobs and heavy joins.
   */
  private listUserSelect(): Prisma.UserSelect {
    return {
      id: true,
      email: true,
      username: true,
      phone: true,
      role: true,
      firstName: true,
      lastName: true,
      gender: true,
      dateOfBirth: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      avatarKey: true,
      studentProfile: {
        select: {
          id: true,
          admissionNo: true,
          religion: true,
          dischargedAt: true,
          parents: {
            where: { relation: 'FATHER' },
            take: 1,
            select: {
              parent: {
                select: { user: { select: { firstName: true, lastName: true } } },
              },
            },
          },
          enrollments: {
            where: { status: 'ACTIVE', academicYear: { isCurrent: true } },
            take: 1,
            select: {
              id: true,
              rollNumber: true,
              section: { select: { id: true, name: true, class: { select: { name: true } } } },
            },
          },
        },
      },
      parentProfile: {
        select: {
          cnic: true,
          occupation: true,
          _count: { select: { children: true } },
          children: {
            take: 6,
            select: {
              relation: true,
              student: { select: { user: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
      },
      teacherProfile: {
        select: {
          id: true,
          employeeCode: true,
          qualification: true,
          specialization: true,
          teachingExperience: true,
          city: true,
          joiningDate: true,
        },
      },
      adminProfile: {
        select: {
          title: true,
        },
      },
    };
  }

  /** Filters shared by the users list and the students export. */
  private buildListWhere(query: ListUsersDto): Prisma.UserWhereInput {
    const today = new Date();
    const yearsAgo = (n: number) =>
      new Date(Date.UTC(today.getUTCFullYear() - n, today.getUTCMonth(), today.getUTCDate()));
    const dob: Prisma.DateTimeNullableFilter = {};
    // Age N means born on or before (today − N years) and after (today − (N+1) years).
    if (query.minAge !== undefined) dob.lte = yearsAgo(query.minAge);
    if (query.maxAge !== undefined) dob.gt = yearsAgo(query.maxAge + 1);
    return {
      ...(query.role ? { role: query.role } : {}),
      ...(query.gender ? { gender: query.gender } : {}),
      ...(query.minAge !== undefined || query.maxAge !== undefined ? { dateOfBirth: dob } : {}),
      ...(query.hasPhoto === 'true' ? { avatarKey: { not: null } } : {}),
      ...(query.hasPhoto === 'false' ? { avatarKey: null } : {}),
      ...(query.religion || query.discharged
        ? {
            AND: [
              ...(query.religion ? [{ studentProfile: { religion: query.religion } }] : []),
              ...(query.discharged === 'true' ? [{ studentProfile: { dischargedAt: { not: null } } }] : []),
              ...(query.discharged === 'false' ? [{ studentProfile: { dischargedAt: null } }] : []),
            ],
          }
        : {}),
      ...(query.isActive !== undefined
        ? { isActive: query.isActive === 'true' }
        : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { username: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
              {
                teacherProfile: {
                  employeeCode: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                studentProfile: {
                  admissionNo: { contains: query.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
  }

  private listOrderBy(sort?: ListUsersDto['sort']): Prisma.UserOrderByWithRelationInput[] {
    switch (sort) {
      case 'oldest':
        return [{ createdAt: 'asc' }];
      case 'name_asc':
        return [{ firstName: 'asc' }, { lastName: 'asc' }];
      case 'name_desc':
        return [{ firstName: 'desc' }, { lastName: 'desc' }];
      default:
        return [{ createdAt: 'desc' }];
    }
  }

  async list(query: ListUsersDto) {
    const { skip, take, page, limit } = getSkipTake(query);
    const where = this.buildListWhere(query);
    const [total, data] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: this.listOrderBy(query.sort),
        select: this.listUserSelect(),
      }),
    ]);
    return paginate(data, total, page, limit);
  }

  /**
   * All students matching the list filters/sort (max 5000) with class, roll number, contacts and parents —
   * feeds the Student data / Contacts / Family list downloads and the Strength report.
   */
  async exportStudents(query: ExportStudentsDto) {
    const where: Prisma.UserWhereInput = {
      ...this.buildListWhere({ ...query, role: Role.STUDENT }),
      ...(query.sectionId
        ? { studentProfile: { enrollments: { some: { sectionId: query.sectionId, status: 'ACTIVE' } } } }
        : {}),
    };
    const users = await this.prisma.user.findMany({
      where,
      orderBy: this.listOrderBy(query.sort),
      take: 5000,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        gender: true,
        dateOfBirth: true,
        isActive: true,
        avatarKey: true,
        createdAt: true,
        studentProfile: {
          select: {
            id: true,
            admissionNo: true,
            address: true,
            religion: true,
            enrollments: {
              where: { status: 'ACTIVE', academicYear: { isCurrent: true } },
              take: 1,
              select: {
                rollNumber: true,
                section: { select: { id: true, name: true, class: { select: { name: true, level: true } } } },
              },
            },
            parents: {
              select: {
                relation: true,
                parent: {
                  select: {
                    id: true,
                    cnic: true,
                    user: { select: { firstName: true, lastName: true, phone: true, email: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const parentOf = (u: (typeof users)[number], relation: string) => {
      const link = u.studentProfile?.parents.find((p) => p.relation === relation);
      if (!link) return null;
      const pu = link.parent.user;
      return {
        id: link.parent.id,
        name: [pu.firstName, pu.lastName].filter((x) => x && x !== '.').join(' '),
        phone: pu.phone,
        email: pu.email,
        cnic: link.parent.cnic,
      };
    };
    return users.map((u) => {
      const e = u.studentProfile?.enrollments[0];
      return {
        userId: u.id,
        studentId: u.studentProfile?.id ?? null,
        admissionNo: u.studentProfile?.admissionNo ?? null,
        name: `${u.firstName} ${u.lastName}`.trim(),
        religion: u.studentProfile?.religion ?? null,
        gender: u.gender,
        dateOfBirth: u.dateOfBirth,
        phone: u.phone,
        email: u.email,
        isActive: u.isActive,
        hasPhoto: !!u.avatarKey,
        city: u.studentProfile?.address?.split('\n')[0] ?? null,
        enrolledAt: u.createdAt,
        sectionId: e?.section.id ?? null,
        className: e?.section.class.name ?? null,
        classLevel: e?.section.class.level ?? null,
        sectionName: e?.section.name ?? null,
        rollNumber: e?.rollNumber ?? null,
        father: parentOf(u, 'FATHER'),
        mother: parentOf(u, 'MOTHER'),
        guardian: parentOf(u, 'GUARDIAN'),
      };
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: this.userSelect(),
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === Role.STUDENT && user.studentProfile?.id) {
      const parentLinks = await this.prisma.parentStudentLink.findMany({
        where: { studentId: user.studentProfile.id },
        orderBy: { createdAt: 'asc' },
        include: {
          parent: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  phone: true,
                  username: true,
                  gender: true,
                  isActive: true,
                  parentProfile: {
                    select: {
                      cnic: true,
                      occupation: true,
                      address: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      const parentIds = parentLinks.map((l) => l.parentId);
      const siblingLinks = parentIds.length
        ? await this.prisma.parentStudentLink.findMany({
            where: { parentId: { in: parentIds }, NOT: { studentId: user.studentProfile.id } },
            distinct: ['studentId'],
            select: {
              student: {
                select: {
                  id: true,
                  admissionNo: true,
                  user: { select: { id: true, firstName: true, lastName: true, isActive: true } },
                  enrollments: {
                    where: { status: 'ACTIVE', academicYear: { isCurrent: true } },
                    take: 1,
                    select: { rollNumber: true, section: { select: { name: true, class: { select: { name: true } } } } },
                  },
                },
              },
            },
          })
        : [];
      return { ...user, parentLinks, siblings: siblingLinks.map((l) => l.student) };
    }

    if (user.role === Role.PARENT && user.parentProfile?.id) {
      const childLinks = await this.prisma.parentStudentLink.findMany({
        where: { parentId: user.parentProfile.id },
        orderBy: { createdAt: 'asc' },
        include: {
          student: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  phone: true,
                  username: true,
                  gender: true,
                  isActive: true,
                  studentProfile: {
                    select: {
                      admissionNo: true,
                      admissionDate: true,
                      bloodGroup: true,
                      address: true,
                      emergencyPhone: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      return { ...user, childLinks };
    }

    return user;
  }

  async createAdmin(dto: CreateAdminDto, canGrantAllCampuses = false) {
    this.assertEmailOrUsername(dto);
    if (dto.allCampuses && !canGrantAllCampuses) {
      throw new ForbiddenException('Only a main admin can give access to both schools.');
    }
    const creds = await this.credentials(dto.password);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        username: dto.username,
        phone: dto.phone,
        ...creds,
        role: Role.ADMIN,
        firstName: dto.firstName,
        lastName: dto.lastName,
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        avatarKey: dto.avatarKey,
        adminProfile: { create: { title: dto.title, allCampuses: !!dto.allCampuses } },
      },
      select: this.userSelect(),
    });
  }

  async createTeacher(dto: CreateTeacherDto) {
    this.assertEmailOrUsername(dto);
    const creds = await this.credentials(dto.password);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        username: dto.username,
        phone: dto.phone,
        ...creds,
        role: Role.TEACHER,
        firstName: dto.firstName,
        lastName: dto.lastName,
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        avatarKey: dto.avatarKey,
        teacherProfile: {
          create: {
            employeeCode: dto.employeeCode,
            qualification: dto.qualification,
            specialization: dto.specialization,
            joiningDate: dto.joiningDate ? new Date(dto.joiningDate) : null,
            bio: dto.bio,
            cnic: dto.cnic,
            city: dto.city,
            teachingExperience: dto.teachingExperience,
            currentWorkplace: dto.currentWorkplace,
            cvKey: dto.cvKey,
            cvOriginalName: dto.cvKey ? dto.cvOriginalName : undefined,
          },
        },
      },
      select: this.userSelect(),
    });
  }

  async createStudent(dto: CreateStudentDto) {
    this.assertEmailOrUsername(dto);
    const creds = await this.credentials(dto.password);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        username: dto.username,
        phone: dto.phone,
        ...creds,
        role: Role.STUDENT,
        firstName: dto.firstName,
        lastName: dto.lastName,
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        avatarKey: dto.avatarKey,
        studentProfile: {
          create: {
            admissionNo: dto.admissionNo,
            admissionDate: dto.admissionDate
              ? new Date(dto.admissionDate)
              : null,
            bloodGroup: dto.bloodGroup,
            address: dto.address,
            emergencyPhone: dto.emergencyPhone,
          },
        },
      },
      select: this.userSelect(),
    });
  }

  async createParent(dto: CreateParentDto) {
    this.assertEmailOrUsername(dto);
    const creds = await this.credentials(dto.password);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          username: dto.username,
          phone: dto.phone,
          ...creds,
          role: Role.PARENT,
          firstName: dto.firstName,
          lastName: dto.lastName,
          gender: dto.gender,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          avatarKey: dto.avatarKey,
          parentProfile: {
            create: {
              occupation: dto.occupation,
              cnic: dto.cnic,
              address: dto.address,
            },
          },
        },
        select: this.userSelect(),
      });

      if (dto.children?.length) {
        const parent = await tx.parentProfile.findUniqueOrThrow({
          where: { userId: user.id },
        });
        await tx.parentStudentLink.createMany({
          data: dto.children.map((c) => ({
            parentId: parent.id,
            studentId: c.studentId,
            relation: c.relation,
            isPrimary: c.isPrimary ?? false,
          })),
        });
      }

      return this.findById(user.id);
    });
  }

  async linkChildToParent(parentUserId: string, dto: ParentChildLinkDto) {
    const parent = await this.prisma.parentProfile.findUnique({
      where: { userId: parentUserId },
    });
    if (!parent) throw new NotFoundException('Parent not found');
    return this.prisma.parentStudentLink.create({
      data: {
        parentId: parent.id,
        studentId: dto.studentId,
        relation: dto.relation,
        isPrimary: dto.isPrimary ?? false,
      },
    });
  }

  async unlinkChildFromParent(parentUserId: string, linkId: string) {
    const parent = await this.prisma.parentProfile.findUnique({
      where: { userId: parentUserId },
    });
    if (!parent) throw new NotFoundException('Parent not found');
    await this.prisma.parentStudentLink.deleteMany({
      where: { id: linkId, parentId: parent.id },
    });
    return { success: true };
  }

  async update(id: string, dto: UpdateUserDto) {
    const existing = await this.findById(id);
    const {
      adminProfile,
      teacherProfile,
      studentProfile,
      parentProfile,
      dateOfBirth,
      ...userFields
    } = dto;

    await this.prisma.user.update({
      where: { id },
      data: {
        ...userFields,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
      },
    });

    if (adminProfile && existing.role === Role.ADMIN && existing.adminProfile) {
      await this.prisma.adminProfile.update({
        where: { userId: id },
        data: adminProfile,
      });
    }

    if (
      teacherProfile &&
      existing.role === Role.TEACHER &&
      existing.teacherProfile
    ) {
      await this.prisma.teacherProfile.update({
        where: { userId: id },
        data: {
          ...teacherProfile,
          joiningDate: teacherProfile.joiningDate
            ? new Date(teacherProfile.joiningDate)
            : undefined,
        },
      });
    }

    if (
      studentProfile &&
      existing.role === Role.STUDENT &&
      existing.studentProfile
    ) {
      await this.prisma.studentProfile.update({
        where: { userId: id },
        data: {
          ...studentProfile,
          admissionDate: studentProfile.admissionDate
            ? new Date(studentProfile.admissionDate)
            : undefined,
        },
      });
    }

    if (
      parentProfile &&
      existing.role === Role.PARENT &&
      existing.parentProfile
    ) {
      await this.prisma.parentProfile.update({
        where: { userId: id },
        data: parentProfile,
      });
    }

    return this.findById(id);
  }

  async deactivate(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: { id: true, isActive: true },
    });
  }

  async activate(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { isActive: true },
      select: { id: true, isActive: true },
    });
  }

  /** Admin: set account password (bcrypt). */
  async adminSetPassword(id: string, rawPassword: string) {
    await this.findById(id);
    await this.prisma.user.update({
      where: { id },
      data: await this.credentials(rawPassword),
      select: { id: true },
    });
    return { success: true as const };
  }

  /** Preview warnings/blockers before hard-deleting a user account. */
  async getDeleteImpact(id: string) {
    const user = await this.findById(id);

    const blockers: string[] = [];
    const warnings: string[] = [];

    const [
      gradesGiven,
      attendanceMarked,
      feePaymentsRecorded,
      salaryPaymentsMade,
      announcementsAuthored,
      mediaUploaded,
    ] = await Promise.all([
      this.prisma.assignmentGrade.count({ where: { gradedById: id } }),
      this.prisma.attendanceRecord.count({ where: { markedById: id } }),
      this.prisma.feePayment.count({ where: { recordedById: id } }),
      this.prisma.salaryPayment.count({ where: { paidById: id } }),
      this.prisma.announcement.count({ where: { authorId: id } }),
      // Photo uploads are removed together with the account, so only other files block a delete.
      this.prisma.mediaAsset.count({ where: { uploaderId: id, NOT: { purpose: 'AVATAR' } } }),
    ]);

    if (gradesGiven > 0) {
      blockers.push(
        `This account graded ${gradesGiven} assignment submission(s). Deactivate instead of deleting.`,
      );
    }
    if (attendanceMarked > 0) {
      blockers.push(
        `This account marked ${attendanceMarked} attendance record(s). Deactivate instead of deleting.`,
      );
    }
    if (feePaymentsRecorded > 0) {
      blockers.push(
        `This account recorded ${feePaymentsRecorded} fee payment(s). Deactivate instead of deleting.`,
      );
    }
    if (salaryPaymentsMade > 0) {
      blockers.push(
        `This account recorded ${salaryPaymentsMade} salary payment(s). Deactivate instead of deleting.`,
      );
    }
    if (announcementsAuthored > 0) {
      blockers.push(
        `This account authored ${announcementsAuthored} announcement(s). Remove or reassign them first.`,
      );
    }
    if (mediaUploaded > 0) {
      blockers.push(
        `This account uploaded ${mediaUploaded} media file(s). Deactivate instead of deleting.`,
      );
    }

    let parentDeleteImpact:
      | {
          linkedChildren: Array<{
            studentUserId: string;
            studentName: string;
            admissionNo: string | null;
            relation: ParentRelation;
            otherParentCount: number;
          }>;
        }
      | undefined;

    let studentDeleteImpact:
      | {
          linkedParentCount: number;
          recordCounts: {
            enrollments: number;
            invoices: number;
            assignmentSubmissions: number;
            quizAttempts: number;
            examResults: number;
            attendanceRecords: number;
          };
        }
      | undefined;

    let teacherDeleteImpact:
      | {
          assignedCourses: number;
          liveClasses: number;
          homeroomSections: number;
        }
      | undefined;

    if (user.role === Role.PARENT && user.parentProfile?.id) {
      const parentId = user.parentProfile.id;
      const links = await this.prisma.parentStudentLink.findMany({
        where: { parentId },
        include: {
          student: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  studentProfile: { select: { admissionNo: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      const linkedChildren = await Promise.all(
        links.map(async (link) => {
          const otherParentCount = await this.prisma.parentStudentLink.count({
            where: {
              studentId: link.studentId,
              parentId: { not: parentId },
            },
          });
          const sUser = link.student.user;
          const studentName =
            [sUser.firstName, sUser.lastName].filter(Boolean).join(' ').trim() ||
            'Student';
          return {
            studentUserId: sUser.id,
            studentName,
            admissionNo: sUser.studentProfile?.admissionNo ?? null,
            relation: link.relation,
            otherParentCount,
          };
        }),
      );

      parentDeleteImpact = { linkedChildren };

      if (linkedChildren.length > 0) {
        warnings.push(
          `This parent is linked to ${linkedChildren.length} student account(s). Deleting this parent removes those links permanently; the student accounts are not deleted.`,
        );
        for (const child of linkedChildren) {
          if (child.otherParentCount === 0) {
            warnings.push(
              `${child.studentName} will have no parent account linked after this deletion.`,
            );
          } else if (child.otherParentCount === 1) {
            warnings.push(
              `${child.studentName} will have 1 remaining parent account after this deletion.`,
            );
          } else {
            warnings.push(
              `${child.studentName} will have ${child.otherParentCount} other parent account(s) after this deletion.`,
            );
          }
        }
      }
    }

    if (user.role === Role.STUDENT && user.studentProfile?.id) {
      const studentId = user.studentProfile.id;
      const [
        enrollments,
        invoices,
        assignmentSubmissions,
        quizAttempts,
        examResults,
        attendanceRecords,
        parentLinkCount,
        admissionLink,
      ] = await Promise.all([
        this.prisma.studentEnrollment.count({ where: { studentId } }),
        this.prisma.feeInvoice.count({ where: { studentId } }),
        this.prisma.assignmentSubmission.count({ where: { studentId } }),
        this.prisma.quizAttempt.count({ where: { studentId } }),
        this.prisma.examResult.count({ where: { studentId } }),
        this.prisma.attendanceRecord.count({ where: { studentId } }),
        this.prisma.parentStudentLink.count({ where: { studentId } }),
        this.prisma.admissionApplication.findFirst({
          where: { studentUserId: id },
          select: { id: true, firstName: true, lastName: true },
        }),
      ]);

      studentDeleteImpact = {
        linkedParentCount: parentLinkCount,
        recordCounts: {
          enrollments,
          invoices,
          assignmentSubmissions,
          quizAttempts,
          examResults,
          attendanceRecords,
        },
      };

      if (parentLinkCount > 0) {
        warnings.push(
          `${parentLinkCount} parent link(s) to this student will be removed. Parent accounts themselves are not deleted.`,
        );
      }
      if (enrollments > 0) {
        warnings.push(`${enrollments} enrollment record(s) will be permanently deleted.`);
      }
      if (invoices > 0) {
        warnings.push(`${invoices} fee invoice(s) and their payment history will be permanently deleted.`);
      }
      if (assignmentSubmissions > 0) {
        warnings.push(`${assignmentSubmissions} assignment submission(s) will be permanently deleted.`);
      }
      if (quizAttempts > 0) {
        warnings.push(`${quizAttempts} quiz attempt(s) will be permanently deleted.`);
      }
      if (examResults > 0) {
        warnings.push(`${examResults} exam result(s) will be permanently deleted.`);
      }
      if (attendanceRecords > 0) {
        warnings.push(`${attendanceRecords} attendance record(s) will be permanently deleted.`);
      }
      if (admissionLink) {
        warnings.push(
          'The linked admission application will lose its provisioned student reference (the application itself remains).',
        );
      }

      warnings.push(
        'Deleting a student is permanent and removes all academic records for this account.',
      );
    }

    if (user.role === Role.TEACHER && user.teacherProfile?.id) {
      const teacherId = user.teacherProfile.id;
      const [assignedCourses, liveClasses, homeroomSections, teacherAppLink] =
        await Promise.all([
          this.prisma.course.count({ where: { teacherId } }),
          this.prisma.liveClass.count({ where: { teacherId } }),
          this.prisma.section.count({ where: { classTeacherId: teacherId } }),
          this.prisma.teacherApplication.findFirst({
            where: { teacherUserId: id },
            select: { id: true },
          }),
        ]);

      teacherDeleteImpact = {
        assignedCourses,
        liveClasses,
        homeroomSections,
      };

      if (assignedCourses > 0) {
        blockers.push(
          `This teacher is assigned to ${assignedCourses} course(s). Reassign or remove those courses first.`,
        );
      }
      if (homeroomSections > 0) {
        blockers.push(
          `This teacher is the class teacher for ${homeroomSections} section(s). Reassign homeroom teacher first.`,
        );
      }
      if (liveClasses > 0) {
        blockers.push(
          `This teacher has ${liveClasses} live class record(s). Remove or reassign them first.`,
        );
      }
      if (teacherAppLink) {
        warnings.push(
          'The linked teacher application will lose its provisioned teacher reference.',
        );
      }
    }

    return {
      canDelete: blockers.length === 0,
      blockers,
      warnings,
      role: user.role,
      parentDeleteImpact,
      studentDeleteImpact,
      teacherDeleteImpact,
    };
  }

  /** Suggested username + employee code when admin manually creates a teacher. */
  async suggestManualTeacherCreate(firstName: string, lastName: string) {
    const base = baseUsernameFromNames(
      firstName?.trim() || 'teacher',
      lastName?.trim() || 'user',
    );
    const teacherUsername = await this.firstAvailableUsernameForSuggestion(
      base,
      new Set(),
    );
    const employeeCode = await this.allocateNextTeacherEmployeeCode();
    return { teacherUsername, employeeCode };
  }

  /** Admin: hard delete user. Fails if foreign keys still reference this user (e.g. fee records). */
  async remove(id: string) {
    const impact = await this.getDeleteImpact(id);
    if (!impact.canDelete) {
      throw new ConflictException(impact.blockers.join(' '));
    }
    try {
      // Photo uploads made by this user would otherwise block the delete (uploader is a required reference).
      await this.prisma.$transaction([
        this.prisma.mediaAsset.deleteMany({ where: { uploaderId: id, purpose: 'AVATAR' } }),
        this.prisma.user.delete({ where: { id } }),
      ]);
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === 'P2003' || code === 'P2014') {
        throw new ConflictException(
          'Cannot delete this user while related records still reference them (for example payments or assignments). Deactivate the account instead, or remove those links first.',
        );
      }
      throw e;
    }
    return { success: true as const };
  }

  private assertEmailOrUsername(dto: { email?: string; username?: string }) {
    if (!dto.email && !dto.username) {
      throw new BadRequestException('email or username is required');
    }
  }

  /**
   * First available usernames derived from applicant names (for admin approve dialog).
   */
  async suggestUsernamesForAdmission(applicationId: string): Promise<{
    studentUsername: string;
    fatherUsername: string;
    motherUsername: string;
  }> {
    const app = await this.prisma.admissionApplication.findUnique({
      where: { id: applicationId },
    });
    if (!app) throw new NotFoundException('Admission application not found');
    const fatherName = app.fatherName?.trim();
    const motherName = app.motherName?.trim();
    if (!fatherName || !motherName) {
      throw new BadRequestException(
        'Father and mother names are required on the application before usernames can be suggested.',
      );
    }
    const ff = this.splitDisplayName(fatherName);
    const mf = this.splitDisplayName(motherName);
    const baseS = baseUsernameFromNames(app.firstName, app.lastName);
    const baseF = baseUsernameFromNames(ff.firstName, ff.lastName);
    const baseM = baseUsernameFromNames(mf.firstName, mf.lastName);
    return this.allocateThreeDistinctUsernames([baseS, baseF, baseM]);
  }

  private async allocateThreeDistinctUsernames(bases: string[]): Promise<{
    studentUsername: string;
    fatherUsername: string;
    motherUsername: string;
  }> {
    const reserved = new Set<string>();
    const out: string[] = [];
    for (const base of bases) {
      const u = await this.firstAvailableUsernameForSuggestion(base, reserved);
      reserved.add(u);
      out.push(u);
    }
    return {
      studentUsername: out[0],
      fatherUsername: out[1],
      motherUsername: out[2],
    };
  }

  /** Picks first `base`, `base1`, … not in DB and not in `reserved`. */
  private async firstAvailableUsernameForSuggestion(
    base: string,
    reserved: Set<string>,
  ): Promise<string> {
    let prefix =
      base
        .toLowerCase()
        .replace(/[^a-z0-9._]/g, '')
        .replace(/^\.+|\.+$/g, '')
        .slice(0, 28) || 'usr';
    if (prefix.length < 3) prefix = `${prefix}usr`.slice(0, 28);

    for (let n = 0; n < 1000; n++) {
      const suffix = n === 0 ? '' : String(n);
      const candidate = `${prefix}${suffix}`.slice(0, 32);
      if (candidate.length < 3) continue;
      if (!isValidUsernameFormat(candidate)) continue;
      const db = await this.prisma.user.findUnique({
        where: { username: candidate },
      });
      if (!db && !reserved.has(candidate)) return candidate;
    }
    throw new BadRequestException(
      'Could not allocate a unique username. Try again later.',
    );
  }

  private async assertProvisionIdentifiersFree(
    studentUsername: string,
    fatherUsername: string,
    motherUsername: string,
    studentEmail: string | null,
  ): Promise<void> {
    const su = studentUsername.trim().toLowerCase();
    const fu = fatherUsername.trim().toLowerCase();
    const mu = motherUsername.trim().toLowerCase();
    const fields: Record<string, string> = {};

    const formatMsg =
      'Use 3–32 characters: start with a letter or digit, then letters, digits, dots, or underscores.';
    if (!isValidUsernameFormat(su)) fields.studentUsername = formatMsg;
    if (!isValidUsernameFormat(fu)) fields.fatherUsername = formatMsg;
    if (!isValidUsernameFormat(mu)) fields.motherUsername = formatMsg;

    if (new Set([su, fu, mu]).size !== 3) {
      if (su === fu)
        fields.fatherUsername =
          fields.fatherUsername || 'Must be different from the student username.';
      if (su === mu)
        fields.motherUsername =
          fields.motherUsername || 'Must be different from the student username.';
      if (fu === mu)
        fields.motherUsername =
          fields.motherUsername ||
          'Father and mother usernames must be different.';
    }

    const checkKeys = [
      ['studentUsername', su],
      ['fatherUsername', fu],
      ['motherUsername', mu],
    ] as const;
    for (const [key, u] of checkKeys) {
      if (fields[key]) continue;
      const exists = await this.prisma.user.findUnique({ where: { username: u } });
      if (exists) {
        fields[key] = 'This username is already taken.';
      }
    }

    if (studentEmail) {
      const exists = await this.prisma.user.findFirst({
        where: { email: studentEmail },
      });
      if (exists) {
        fields.studentEmail =
          'This email is already registered to another account.';
      }
    }

    if (Object.keys(fields).length) {
      throw new BadRequestException({
        message:
          'Could not create accounts: fix the login identifiers highlighted below.',
        fields,
      });
    }
  }

  /** Same shape as admission approval: student + father + mother users and parent links. */
  private async provisionFamilyAccountsInTransaction(
    tx: Prisma.TransactionClient,
    params: {
      studentFirstName: string;
      studentLastName: string;
      studentGender: Gender | null;
      studentDateOfBirth: Date | null;
      studentPhone: string;
      studentAddress: string;
      bloodGroup: string | null;
      record: StudentRecordFields;
      /** Sibling admission: link these existing parent profiles instead of creating father/mother accounts. */
      existingParents?: { parentId: string; relation: ParentRelation }[];
      fatherName: string;
      motherName: string;
      fatherCnic: string | null;
      motherCnic: string | null;
      fatherPhone: string | null;
      motherPhone: string | null;
      studentUsername: string;
      fatherUsername: string;
      motherUsername: string;
      studentEmail: string | null;
      studentPasswordHash: string;
      fatherPasswordHash: string | null;
      motherPasswordHash: string | null;
      /** Admin-viewable encrypted copies of the issued passwords. */
      studentPasswordEnc: string;
      fatherPasswordEnc: string | null;
      motherPasswordEnc: string | null;
      parentAddressLine: string;
    },
  ): Promise<{ studentUserId: string }> {
    const admissionNo = await this.allocateAdmissionNo(tx);
    const ff = this.splitDisplayName(params.fatherName);
    const mf = this.splitDisplayName(params.motherName);

    const studentUser = await tx.user.create({
      data: {
        username: params.studentUsername,
        email: params.studentEmail,
        phone: params.studentPhone,
        passwordHash: params.studentPasswordHash,
        issuedPasswordEnc: params.studentPasswordEnc,
        role: Role.STUDENT,
        firstName: params.studentFirstName,
        lastName: params.studentLastName,
        gender: params.studentGender ?? undefined,
        dateOfBirth: params.studentDateOfBirth,
        studentProfile: {
          create: {
            admissionNo,
            admissionDate: new Date(),
            address: params.studentAddress,
            bloodGroup: params.bloodGroup,
            ...params.record,
            emergencyPhone:
              params.fatherPhone ||
              params.motherPhone ||
              params.studentPhone,
          },
        },
      },
      include: { studentProfile: true },
    });

    if (params.existingParents?.length) {
      await tx.parentStudentLink.createMany({
        data: params.existingParents.map((p) => ({
          parentId: p.parentId,
          studentId: studentUser.studentProfile!.id,
          relation: p.relation,
          isPrimary: p.relation === ParentRelation.FATHER,
        })),
      });
      return { studentUserId: studentUser.id };
    }

    const fatherPhone = await this.pickUniquePhone(tx, params.fatherPhone, [
      params.studentPhone,
    ]);
    const motherPhone = await this.pickUniquePhone(tx, params.motherPhone, [
      params.studentPhone,
      ...(fatherPhone ? [fatherPhone] : []),
    ]);

    const fatherUser = await tx.user.create({
      data: {
        username: params.fatherUsername,
        phone: fatherPhone,
        passwordHash: params.fatherPasswordHash!,
        issuedPasswordEnc: params.fatherPasswordEnc,
        role: Role.PARENT,
        firstName: ff.firstName,
        lastName: ff.lastName,
        gender: Gender.MALE,
        parentProfile: {
          create: {
            cnic: params.fatherCnic,
            address: params.parentAddressLine,
          },
        },
      },
      include: { parentProfile: true },
    });

    const motherUser = await tx.user.create({
      data: {
        username: params.motherUsername,
        phone: motherPhone,
        passwordHash: params.motherPasswordHash!,
        issuedPasswordEnc: params.motherPasswordEnc,
        role: Role.PARENT,
        firstName: mf.firstName,
        lastName: mf.lastName,
        gender: Gender.FEMALE,
        parentProfile: {
          create: {
            cnic: params.motherCnic,
            address: params.parentAddressLine,
          },
        },
      },
      include: { parentProfile: true },
    });

    const studentProfileId = studentUser.studentProfile!.id;

    await tx.parentStudentLink.createMany({
      data: [
        {
          parentId: fatherUser.parentProfile!.id,
          studentId: studentProfileId,
          relation: ParentRelation.FATHER,
          isPrimary: true,
        },
        {
          parentId: motherUser.parentProfile!.id,
          studentId: studentProfileId,
          relation: ParentRelation.MOTHER,
          isPrimary: false,
        },
      ],
    });

    return { studentUserId: studentUser.id };
  }

  /**
   * Admin: create student + both parents in one step (same as admission approval provisioning).
   */
  async createStudentWithParents(dto: CreateStudentWithParentsDto) {
    const sibling = dto.siblingOfStudentId ? await this.siblingFamily(dto.siblingOfStudentId) : null;
    const fatherName = sibling ? '' : (dto.fatherName ?? '').trim();
    const motherName = sibling ? '' : (dto.motherName ?? '').trim();
    if (!sibling && (!fatherName || !motherName)) {
      throw new BadRequestException('Father and mother names are required.');
    }

    const studentEmail = dto.studentAccountEmail?.trim()
      ? dto.studentAccountEmail.trim().toLowerCase()
      : null;
    const su = dto.studentUsername.trim().toLowerCase();
    const fu = sibling ? '' : (dto.fatherUsername ?? '').trim().toLowerCase();
    const mu = sibling ? '' : (dto.motherUsername ?? '').trim().toLowerCase();

    if (sibling) await this.assertStudentIdentifiersFree(su, studentEmail);
    else await this.assertProvisionIdentifiersFree(su, fu, mu, studentEmail);

    // Optional: admit straight into a class/section with a roll number.
    const enrollTarget = await this.resolveEnrollmentTarget(dto.sectionId, dto.rollNumber);
    const rollNumber = enrollTarget?.rollNumber ?? '';
    const enrollTo = enrollTarget
      ? { sectionId: enrollTarget.sectionId, academicYearId: enrollTarget.academicYearId }
      : null;

    const city = dto.city.trim();
    const studentAddress = city;

    const [studentPasswordHash, fatherPasswordHash, motherPasswordHash] =
      await Promise.all([
        this.hashPassword(dto.studentPassword),
        sibling ? null : this.hashPassword(dto.fatherPassword),
        sibling ? null : this.hashPassword(dto.motherPassword),
      ]);

    const studentDob = dto.dateOfBirth
      ? new Date(dto.dateOfBirth)
      : null;

    const { studentUserId } = await this.prisma.$transaction(
      async (tx) => {
        const created = await this.provisionFamilyAccountsInTransaction(tx, {
          studentFirstName: dto.firstName.trim(),
          studentLastName: dto.lastName.trim(),
          studentGender: dto.gender ?? null,
          studentDateOfBirth: studentDob,
          studentPhone: dto.phone.trim(),
          studentAddress,
          bloodGroup: dto.bloodGroup?.trim() || null,
          record: this.studentRecordFrom(dto),
          existingParents: sibling?.links,
          fatherName,
          motherName,
          fatherCnic: dto.fatherCnic?.trim() || null,
          motherCnic: dto.motherCnic?.trim() || null,
          fatherPhone: dto.fatherPhone?.trim() || null,
          motherPhone: dto.motherPhone?.trim() || null,
          studentUsername: su,
          fatherUsername: fu,
          motherUsername: mu,
          studentEmail,
          studentPasswordHash,
          fatherPasswordHash,
          motherPasswordHash,
          studentPasswordEnc: this.vault.seal(dto.studentPassword),
          fatherPasswordEnc: sibling ? null : this.vault.seal(dto.fatherPassword),
          motherPasswordEnc: sibling ? null : this.vault.seal(dto.motherPassword),
          parentAddressLine: city,
        });
        if (enrollTo) {
          const profile = await tx.studentProfile.findUniqueOrThrow({
            where: { userId: created.studentUserId },
          });
          await tx.studentEnrollment.create({
            data: { studentId: profile.id, ...enrollTo, rollNumber },
          });
        }
        return created;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    return this.findById(studentUserId);
  }

  /**
   * Validates an optional class/section + roll number (both or neither; section exists; roll free).
   * Shared by Add student, admin "Pending Enrolled" and admission approval.
   */
  async resolveEnrollmentTarget(
    sectionId?: string | null,
    rollRaw?: string | null,
  ): Promise<{ sectionId: string; academicYearId: string; rollNumber: string } | null> {
    const rollNumber = rollRaw?.trim() || '';
    if (!sectionId && !rollNumber) return null;
    if (!sectionId || !rollNumber) {
      throw new BadRequestException({
        message: 'Choose a class/section and enter a roll number (or leave both empty)',
        fields: sectionId ? { rollNumber: 'Required with a class/section' } : { sectionId: 'Required with a roll number' },
      });
    }
    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
      include: { class: true },
    });
    if (!section) throw new BadRequestException({ message: 'Class/section not found', fields: { sectionId: 'Not found' } });
    const taken = await this.prisma.studentEnrollment.findFirst({
      where: { sectionId: section.id, rollNumber },
    });
    if (taken) {
      throw new ConflictException({
        message: `Roll number ${rollNumber} is already used in this section`,
        fields: { rollNumber: 'Already used in this section' },
      });
    }
    return { sectionId: section.id, academicYearId: section.class.academicYearId, rollNumber };
  }

  /** Admission details stored in their own StudentProfile fields. */
  private studentRecordFrom(d: {
    religion?: string | null;
    gradeLevel?: string | null;
    curriculum?: string | null;
    preferredShift?: string | null;
    studentBFormNo?: string | null;
    guardianName?: string | null;
    guardianRelation?: string | null;
    guardianPhone?: string | null;
  }): StudentRecordFields {
    const v = (x?: string | null) => x?.trim() || null;
    return {
      appliedClass: v(d.gradeLevel),
      curriculum: v(d.curriculum),
      preferredShift: v(d.preferredShift)?.toLowerCase() ?? null,
      bFormNo: v(d.studentBFormNo),
      guardianName: v(d.guardianName),
      guardianRelation: v(d.guardianRelation),
      guardianPhone: v(d.guardianPhone),
      religion: v(d.religion),
    };
  }

  /** Parents of an existing student, for a sibling admission (father/mother/guardian links are reused). */
  async siblingFamily(siblingStudentProfileId: string) {
    const sib = await this.prisma.studentProfile.findUnique({
      where: { id: siblingStudentProfileId },
      include: {
        parents: {
          include: {
            parent: {
              select: { id: true, cnic: true, user: { select: { firstName: true, lastName: true, phone: true } } },
            },
          },
        },
      },
    });
    if (!sib) {
      throw new BadRequestException({ message: 'Sibling not found', fields: { siblingOfStudentId: 'Not found' } });
    }
    if (!sib.parents.length) {
      throw new BadRequestException({
        message: 'That student has no parent accounts to link. Add the student without the sibling option.',
        fields: { siblingOfStudentId: 'No parents linked' },
      });
    }
    const of = (r: ParentRelation) => sib.parents.find((p) => p.relation === r)?.parent;
    const name = (p?: { user: { firstName: string; lastName: string } }) =>
      p ? [p.user.firstName, p.user.lastName].filter((x) => x && x !== '.').join(' ') : null;
    return {
      links: sib.parents.map((p) => ({ parentId: p.parentId, relation: p.relation })),
      father: of(ParentRelation.FATHER),
      mother: of(ParentRelation.MOTHER),
      fatherName: name(of(ParentRelation.FATHER)),
      motherName: name(of(ParentRelation.MOTHER)),
    };
  }

  /** Student-only login checks (sibling admissions create no parent accounts). */
  private async assertStudentIdentifiersFree(username: string, email: string | null) {
    const fields: Record<string, string> = {};
    if (!isValidUsernameFormat(username)) {
      fields.studentUsername = 'Use 3–32 characters: start with a letter or digit, then letters, digits, dots, or underscores.';
    } else if (await this.prisma.user.findUnique({ where: { username } })) {
      fields.studentUsername = 'This username is already taken.';
    }
    if (email && (await this.prisma.user.findFirst({ where: { email } }))) {
      fields.studentEmail = 'This email is already registered to another account.';
    }
    if (Object.keys(fields).length) {
      throw new BadRequestException({ message: 'Could not create the account: fix the login details highlighted below.', fields });
    }
  }

  /**
   * Admin "Edit student" — the whole record: student, admission details, parents (through the student's links)
   * and the current-year class/section + roll (created or moved; left alone when not given).
   */
  async updateStudentRecord(userId: string, dto: UpdateStudentRecordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { studentProfile: { include: { parents: { include: { parent: { include: { user: true } } } } } } },
    });
    if (!user || user.role !== Role.STUDENT || !user.studentProfile) throw new NotFoundException('Student not found');
    const profile = user.studentProfile;

    const email = dto.studentAccountEmail?.trim() ? dto.studentAccountEmail.trim().toLowerCase() : null;
    const phone = dto.phone.trim();
    const fields: Record<string, string> = {};
    if (email && email !== user.email && (await this.prisma.user.findFirst({ where: { email, NOT: { id: userId } } }))) {
      fields.studentEmail = 'This email is already registered to another account.';
    }
    if (phone !== user.phone && (await this.prisma.user.findFirst({ where: { phone, NOT: { id: userId } } }))) {
      fields.phone = 'This phone number is already linked to another user.';
    }
    const parentOf = (r: ParentRelation) => profile.parents.find((p) => p.relation === r)?.parent;
    const father = parentOf(ParentRelation.FATHER);
    const mother = parentOf(ParentRelation.MOTHER);
    for (const [key, parent, raw] of [
      ['fatherPhone', father, dto.fatherPhone],
      ['motherPhone', mother, dto.motherPhone],
    ] as const) {
      const p = raw?.trim() || null;
      if (parent && p && p !== parent.user.phone && (await this.prisma.user.findFirst({ where: { phone: p, NOT: { id: parent.userId } } }))) {
        fields[key] = 'This phone number is already linked to another user.';
      }
    }
    if (Object.keys(fields).length) throw new BadRequestException({ message: 'Please fix the highlighted fields.', fields });

    // class/section: only when given; moving keeps one enrollment per year
    let enroll: { sectionId: string; academicYearId: string; rollNumber: string } | null = null;
    if (dto.sectionId || dto.rollNumber?.trim()) {
      const current = await this.prisma.studentEnrollment.findFirst({
        where: { studentId: profile.id, sectionId: dto.sectionId ?? undefined, rollNumber: dto.rollNumber?.trim() },
      });
      if (!current) enroll = await this.resolveEnrollmentTarget(dto.sectionId, dto.rollNumber);
    }

    const v = (x?: string | null) => x?.trim() || null;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          phone,
          email,
          gender: dto.gender ?? null,
          dateOfBirth: new Date(dto.dateOfBirth),
        },
      });
      await tx.studentProfile.update({
        where: { id: profile.id },
        data: {
          address: dto.city.trim(),
          bloodGroup: v(dto.bloodGroup),
          curriculum: v(dto.curriculum),
          preferredShift: v(dto.preferredShift),
          bFormNo: v(dto.studentBFormNo),
          guardianName: v(dto.guardianName),
          guardianRelation: v(dto.guardianRelation),
          guardianPhone: v(dto.guardianPhone),
          religion: v(dto.religion),
        },
      });
      for (const [parent, nameRaw, cnic, ph] of [
        [father, dto.fatherName, dto.fatherCnic, dto.fatherPhone],
        [mother, dto.motherName, dto.motherCnic, dto.motherPhone],
      ] as const) {
        if (!parent) continue;
        const n = nameRaw?.trim() ? this.splitDisplayName(nameRaw) : null;
        await tx.user.update({
          where: { id: parent.userId },
          data: { ...(n ? { firstName: n.firstName, lastName: n.lastName } : {}), phone: v(ph) },
        });
        await tx.parentProfile.update({ where: { id: parent.id }, data: { cnic: v(cnic) } });
      }
      if (enroll) {
        const existing = await tx.studentEnrollment.findFirst({
          where: { studentId: profile.id, academicYearId: enroll.academicYearId },
        });
        if (existing) {
          await tx.studentEnrollment.update({
            where: { id: existing.id },
            data: { sectionId: enroll.sectionId, rollNumber: enroll.rollNumber, status: 'ACTIVE' },
          });
        } else {
          await tx.studentEnrollment.create({ data: { studentId: profile.id, ...enroll } });
        }
      }
    });
    return this.findById(userId);
  }

  /**
   * Creates the student user, father and mother parent users, links them to the student,
   * and marks the admission application approved with `studentUserId` set.
   */
  async provisionAccountsForApprovedAdmission(
    applicationId: string,
    accounts: {
      studentUsername: string;
      fatherUsername: string;
      motherUsername: string;
      studentEmail: string | null;
      studentPassword: string;
      fatherPassword: string;
      motherPassword: string;
      /** Class chosen in the approval window (overrides the one saved on the application). */
      sectionId?: string | null;
      rollNumber?: string | null;
    },
  ): Promise<{ accountsProvisioned: boolean }> {
    const app = await this.prisma.admissionApplication.findUnique({
      where: { id: applicationId },
    });
    if (!app) throw new NotFoundException('Admission application not found');
    if (app.studentUserId) {
      return { accountsProvisioned: false };
    }

    const sibling = app.siblingOfStudentId ? await this.siblingFamily(app.siblingOfStudentId) : null;
    const fatherName = app.fatherName?.trim() ?? '';
    const motherName = app.motherName?.trim() ?? '';
    if (!sibling && (!fatherName || !motherName)) {
      throw new BadRequestException(
        'Father and mother names are required on the application before approval can create accounts.',
      );
    }

    const studentEmail = accounts.studentEmail;
    const su = accounts.studentUsername.trim().toLowerCase();
    const fu = sibling ? '' : accounts.fatherUsername.trim().toLowerCase();
    const mu = sibling ? '' : accounts.motherUsername.trim().toLowerCase();

    if (sibling) await this.assertStudentIdentifiersFree(su, studentEmail);
    else await this.assertProvisionIdentifiersFree(su, fu, mu, studentEmail);
    const chosenSection = accounts.sectionId || app.sectionId;
    const chosenRoll = accounts.sectionId ? accounts.rollNumber : app.rollNumber;
    const enrollTarget = await this.resolveEnrollmentTarget(chosenSection, chosenSection ? chosenRoll : null);

    const [studentPasswordHash, fatherPasswordHash, motherPasswordHash] =
      await Promise.all([
        this.hashPassword(accounts.studentPassword),
        sibling ? null : this.hashPassword(accounts.fatherPassword),
        sibling ? null : this.hashPassword(accounts.motherPassword),
      ]);

    const city = app.city.trim();

    await this.prisma.$transaction(
      async (tx) => {
        const { studentUserId } = await this.provisionFamilyAccountsInTransaction(
          tx,
          {
            studentFirstName: app.firstName.trim(),
            studentLastName: app.lastName.trim(),
            studentGender: app.gender ?? null,
            studentDateOfBirth: app.dateOfBirth,
            studentPhone: app.phone.trim(),
            studentAddress: city,
            bloodGroup: app.bloodGroup?.trim() || null,
            record: this.studentRecordFrom(app),
            existingParents: sibling?.links,
            fatherName,
            motherName,
            fatherCnic: app.fatherCnic?.trim() || null,
            motherCnic: app.motherCnic?.trim() || null,
            fatherPhone: app.fatherPhone?.trim() || null,
            motherPhone: app.motherPhone?.trim() || null,
            studentUsername: su,
            fatherUsername: fu,
            motherUsername: mu,
            studentEmail,
            studentPasswordHash,
            fatherPasswordHash,
            motherPasswordHash,
            studentPasswordEnc: this.vault.seal(accounts.studentPassword),
            fatherPasswordEnc: sibling ? null : this.vault.seal(accounts.fatherPassword),
            motherPasswordEnc: sibling ? null : this.vault.seal(accounts.motherPassword),
            parentAddressLine: city,
          },
        );

        if (enrollTarget) {
          const profile = await tx.studentProfile.findUniqueOrThrow({ where: { userId: studentUserId } });
          await tx.studentEnrollment.create({
            data: {
              studentId: profile.id,
              sectionId: enrollTarget.sectionId,
              academicYearId: enrollTarget.academicYearId,
              rollNumber: enrollTarget.rollNumber,
            },
          });
        }

        await tx.admissionApplication.update({
          where: { id: app.id },
          data: {
            status: AdmissionApplicationStatus.APPROVED,
            studentUserId,
          },
        });
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    return { accountsProvisioned: true };
  }

  private splitDisplayName(raw: string): { firstName: string; lastName: string } {
    const t = raw.trim();
    if (!t) return { firstName: 'Parent', lastName: 'Unknown' };
    const parts = t.split(/\s+/);
    if (parts.length === 1) return { firstName: parts[0], lastName: '.' };
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
  }

  /** Separate serial number per school: ON-2026-0001 (online), PH-2026-0001 (physical). */
  private async allocateAdmissionNo(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const school = (currentCampus() ?? Campus.ONLINE) === Campus.PHYSICAL ? 'PH' : 'ON';
    const prefix = `${school}-${new Date().getFullYear()}-`;
    const last = await tx.studentProfile.findFirst({
      where: { admissionNo: { startsWith: prefix } },
      orderBy: { admissionNo: 'desc' },
      select: { admissionNo: true },
    });
    let n = last ? parseInt(last.admissionNo.slice(prefix.length), 10) || 0 : 0;
    for (let i = 0; i < 20; i++) {
      n += 1;
      const candidate = `${prefix}${String(n).padStart(4, '0')}`;
      const exists = await tx.studentProfile.findUnique({ where: { admissionNo: candidate } });
      if (!exists) return candidate;
    }
    throw new Error('Could not allocate admission number');
  }

  /** Main admin: active students/teachers/admins/parents and pending applications per school, plus the total. */
  async campusTotals() {
    return runUnscoped(async () => {
      const rows = await Promise.all(
        [Campus.ONLINE, Campus.PHYSICAL].map(async (campus) => {
          const [students, teachers, admins, parents, pendingAdmissions, pendingTeachers] = await Promise.all([
            this.prisma.user.count({ where: { campus, role: Role.STUDENT, isActive: true } }),
            this.prisma.user.count({ where: { campus, role: Role.TEACHER, isActive: true } }),
            this.prisma.user.count({ where: { campus, role: Role.ADMIN, isActive: true } }),
            this.prisma.user.count({ where: { campus, role: Role.PARENT, isActive: true } }),
            this.prisma.admissionApplication.count({ where: { campus, status: AdmissionApplicationStatus.PENDING } }),
            this.prisma.teacherApplication.count({ where: { campus, status: TeacherApplicationStatus.PENDING } }),
          ]);
          return { campus, students, teachers, admins, parents, pendingAdmissions, pendingTeachers };
        }),
      );
      const keys = ['students', 'teachers', 'admins', 'parents', 'pendingAdmissions', 'pendingTeachers'] as const;
      const total = Object.fromEntries(keys.map((k) => [k, rows.reduce((sum, r) => sum + r[k], 0)]));
      return { campuses: rows, total };
    });
  }

  private async pickUniquePhone(
    tx: Prisma.TransactionClient,
    candidate: string | null | undefined,
    exclude: string[],
  ): Promise<string | undefined> {
    const p = candidate?.trim();
    if (!p) return undefined;
    if (exclude.some((e) => e === p)) return undefined;
    const taken = await tx.user.findFirst({ where: { phone: p } });
    if (taken) return undefined;
    return p;
  }

  /**
   * Suggested LMS username + employee code for approving a teacher application.
   */
  async suggestProvisionForTeacherApplication(applicationId: string): Promise<{
    teacherUsername: string;
    employeeCode: string;
  }> {
    const app = await this.prisma.teacherApplication.findUnique({
      where: { id: applicationId },
    });
    if (!app) throw new NotFoundException('Teacher application not found');
    const base = baseUsernameFromNames(app.firstName, app.lastName);
    const teacherUsername = await this.firstAvailableUsernameForSuggestion(
      base,
      new Set(),
    );
    const employeeCode = await this.allocateNextTeacherEmployeeCode();
    return { teacherUsername, employeeCode };
  }

  private async allocateNextTeacherEmployeeCode(): Promise<string> {
    for (let n = 1; n < 999_999; n++) {
      const code = `TCH${String(n).padStart(5, '0')}`;
      const exists = await this.prisma.teacherProfile.findUnique({
        where: { employeeCode: code },
      });
      if (!exists) return code;
    }
    throw new BadRequestException('Could not allocate employee code.');
  }

  private async assertTeacherProvisionIdentifiersFree(params: {
    username: string;
    employeeCode: string;
    email: string;
    phone: string;
  }): Promise<void> {
    const u = params.username.trim().toLowerCase();
    const fields: Record<string, string> = {};

    const formatMsg =
      'Use 3–32 characters: start with a letter or digit, then letters, digits, dots, or underscores.';
    if (!isValidUsernameFormat(u)) fields.teacherUsername = formatMsg;

    const ec = params.employeeCode?.trim() ?? '';
    if (!ec) fields.employeeCode = 'Employee code is required.';

    if (!fields.teacherUsername) {
      const exists = await this.prisma.user.findUnique({ where: { username: u } });
      if (exists) fields.teacherUsername = 'This username is already taken.';
    }

    const em = params.email.trim().toLowerCase();
    const emailUser = await this.prisma.user.findFirst({ where: { email: em } });
    if (emailUser) {
      fields.email = 'This email is already registered to another account.';
    }

    const ph = params.phone.trim();
    if (ph) {
      const phoneUser = await this.prisma.user.findFirst({ where: { phone: ph } });
      if (phoneUser) {
        fields.phone =
          'This phone number is already linked to another LMS user.';
      }
    }

    if (!fields.employeeCode) {
      const ecTaken = await this.prisma.teacherProfile.findUnique({
        where: { employeeCode: ec },
      });
      if (ecTaken) fields.employeeCode = 'This employee code is already in use.';
    }

    if (Object.keys(fields).length) {
      throw new BadRequestException({
        message:
          'Could not create teacher account: fix the issues highlighted below.',
        fields,
      });
    }
  }

  /**
   * Creates TEACHER user + profile and links `TeacherApplication.teacherUserId`.
   */
  async provisionTeacherFromApprovedApplication(
    applicationId: string,
    accounts: {
      teacherUsername: string;
      teacherPassword: string;
      employeeCode: string;
    },
  ): Promise<{ accountsProvisioned: boolean }> {
    const app = await this.prisma.teacherApplication.findUnique({
      where: { id: applicationId },
    });
    if (!app) throw new NotFoundException('Teacher application not found');
    if (app.teacherUserId) {
      return { accountsProvisioned: false };
    }

    await this.assertTeacherProvisionIdentifiersFree({
      username: accounts.teacherUsername,
      employeeCode: accounts.employeeCode,
      email: app.email,
      phone: app.phone,
    });

    const creds = await this.credentials(accounts.teacherPassword.trim());
    const tu = accounts.teacherUsername.trim().toLowerCase();
    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: app.email.trim().toLowerCase(),
            username: tu,
            phone: app.phone.trim(),
            ...creds,
            role: Role.TEACHER,
            firstName: app.firstName.trim(),
            lastName: app.lastName.trim(),
            gender: app.gender ?? null,
            dateOfBirth: app.dateOfBirth ?? null,
            teacherProfile: {
              create: {
                employeeCode: accounts.employeeCode.trim(),
                qualification: app.highestQualification,
                specialization: app.subjectExpertise,
                joiningDate: app.joiningDate ?? new Date(),
                bio: app.bio ?? null,
                cnic: app.cnic.trim(),
                city: app.city.trim(),
                teachingExperience: app.teachingExperience.trim(),
                currentWorkplace: app.currentWorkplace?.trim() || null,
                cvKey: app.cvKey,
                cvOriginalName: app.cvKey ? app.cvOriginalName : null,
              },
            },
          },
          select: { id: true },
        });

        await tx.teacherApplication.update({
          where: { id: applicationId },
          data: {
            status: TeacherApplicationStatus.APPROVED,
            teacherUserId: user.id,
          },
        });
      });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === 'P2002') {
        throw new BadRequestException(
          'Could not create this teacher account because a unique field (email, phone, username, or employee code) is already in use.',
        );
      }
      throw e;
    }

    return { accountsProvisioned: true };
  }

  // ---------------- Discharge (student left the school) / re-admission / leaving certificate ----------------

  /** Leaving-certificate number per school: ON-LC-2026-0001 / PH-LC-2026-0001. */
  private async nextCertificateNo(tx: Prisma.TransactionClient): Promise<{ prefix: string; next: number }> {
    const prefix = `${(currentCampus() ?? Campus.ONLINE) === Campus.PHYSICAL ? 'PH' : 'ON'}-LC-${new Date().getFullYear()}-`;
    const last = await runUnscoped(() =>
      tx.studentDischarge.findFirst({ where: { certificateNo: { startsWith: prefix } }, orderBy: { certificateNo: 'desc' }, select: { certificateNo: true } }),
    );
    return { prefix, next: (last ? parseInt(last.certificateNo.slice(prefix.length), 10) || 0 : 0) + 1 };
  }

  /**
   * Discharge students: record leaving date/reason (+ certificate data), block the student's login, withdraw the
   * active enrollment, and block parents who have no other current child at school.
   */
  async dischargeStudents(dto: DischargeStudentsDto, actorId: string) {
    const ids = [...new Set(dto.studentIds)];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, role: Role.STUDENT },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        studentProfile: {
          select: {
            id: true,
            dischargedAt: true,
            parents: { select: { parentId: true } },
            enrollments: {
              where: { status: 'ACTIVE' },
              select: { id: true, rollNumber: true, academicYear: { select: { isCurrent: true } }, section: { select: { name: true, class: { select: { name: true } } } } },
            },
          },
        },
      },
    });
    if (users.length !== ids.length || users.some((u) => !u.studentProfile)) throw new NotFoundException('Some students were not found');
    const already = users.filter((u) => u.studentProfile!.dischargedAt);
    if (already.length) {
      throw new ConflictException(`Already discharged: ${already.map((u) => `${u.firstName} ${u.lastName}`).join(', ')}`);
    }
    const leavingDate = new Date(`${dto.leavingDate.slice(0, 10)}T00:00:00.000Z`);
    const parentIds = [...new Set(users.flatMap((u) => u.studentProfile!.parents.map((p) => p.parentId)))];

    const records = await this.prisma.$transaction(
      async (tx) => {
        const cert = await this.nextCertificateNo(tx);
        const out: Prisma.StudentDischargeGetPayload<object>[] = [];
        for (const u of users) {
          const sp = u.studentProfile!;
          const current = sp.enrollments.find((e) => e.academicYear.isCurrent) ?? sp.enrollments[0];
          out.push(
            await tx.studentDischarge.create({
              data: {
                studentId: sp.id,
                certificateNo: `${cert.prefix}${String(cert.next++).padStart(4, '0')}`,
                leavingDate,
                reason: dto.reason.trim(),
                conduct: dto.conduct?.trim() || null,
                remarks: dto.remarks?.trim() || null,
                classAtLeaving: current ? [current.section.class.name, current.section.name].filter(Boolean).join(' · ') : null,
                rollNumber: current?.rollNumber ?? null,
                dischargedById: actorId,
              },
            }),
          );
          await tx.studentProfile.update({ where: { id: sp.id }, data: { dischargedAt: leavingDate } });
          await tx.user.update({ where: { id: u.id }, data: { isActive: false } });
          await tx.studentEnrollment.updateMany({ where: { studentId: sp.id, status: 'ACTIVE' }, data: { status: 'WITHDRAWN' } });
          await tx.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
        }
        // Parents with no other current child at school lose portal access too.
        if (parentIds.length) {
          const parents = await tx.parentProfile.findMany({
            where: { id: { in: parentIds } },
            select: { userId: true, children: { select: { student: { select: { dischargedAt: true } } } } },
          });
          for (const p of parents) {
            if (p.children.every((c) => c.student.dischargedAt)) {
              await tx.user.update({ where: { id: p.userId }, data: { isActive: false } });
              await tx.refreshToken.updateMany({ where: { userId: p.userId, revokedAt: null }, data: { revokedAt: new Date() } });
            }
          }
        }
        return out;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    return { discharged: records.length, records };
  }

  /** Re-admit a discharged student into a class/section + roll; student and parents can log in again. */
  async readmitStudent(userId: string, dto: ReadmitStudentDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, studentProfile: { select: { id: true, dischargedAt: true, parents: { select: { parent: { select: { userId: true } } } } } } },
    });
    if (!user || user.role !== Role.STUDENT || !user.studentProfile) throw new NotFoundException('Student not found');
    const sp = user.studentProfile;
    if (!sp.dischargedAt) throw new BadRequestException('This student is not discharged.');
    const rollNumber = dto.rollNumber.trim();
    const section = await this.prisma.section.findUnique({ where: { id: dto.sectionId }, include: { class: true } });
    if (!section) throw new BadRequestException({ message: 'Class/section not found', fields: { sectionId: 'Not found' } });
    if (!rollNumber) throw new BadRequestException({ message: 'Enter a roll number', fields: { rollNumber: 'Required' } });
    const taken = await this.prisma.studentEnrollment.findFirst({ where: { sectionId: section.id, rollNumber, NOT: { studentId: sp.id } } });
    if (taken) {
      throw new ConflictException({ message: `Roll number ${rollNumber} is already used in this section`, fields: { rollNumber: 'Already used in this section' } });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.studentProfile.update({ where: { id: sp.id }, data: { dischargedAt: null } });
      await tx.user.update({ where: { id: user.id }, data: { isActive: true } });
      const open = await tx.studentDischarge.findFirst({ where: { studentId: sp.id, readmittedAt: null }, orderBy: { createdAt: 'desc' } });
      if (open) await tx.studentDischarge.update({ where: { id: open.id }, data: { readmittedAt: new Date() } });
      for (const l of sp.parents) await tx.user.update({ where: { id: l.parent.userId }, data: { isActive: true } });
      const existing = await tx.studentEnrollment.findFirst({ where: { studentId: sp.id, academicYearId: section.class.academicYearId } });
      if (existing) {
        await tx.studentEnrollment.update({ where: { id: existing.id }, data: { sectionId: section.id, rollNumber, status: 'ACTIVE' } });
      } else {
        await tx.studentEnrollment.create({ data: { studentId: sp.id, sectionId: section.id, academicYearId: section.class.academicYearId, rollNumber } });
      }
    });
    return this.findById(userId);
  }

  /** Discharged students (newest first) with their latest discharge record. */
  async listDischarged(query: ListDischargedDto) {
    const { skip, take, page, limit } = getSkipTake(query);
    const where: Prisma.UserWhereInput = {
      role: Role.STUDENT,
      studentProfile: { dischargedAt: { not: null } },
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { studentProfile: { admissionNo: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [total, data] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { studentProfile: { dischargedAt: 'desc' } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatarKey: true,
          dateOfBirth: true,
          studentProfile: {
            select: {
              id: true,
              admissionNo: true,
              admissionDate: true,
              dischargedAt: true,
              parents: { where: { relation: 'FATHER' }, take: 1, select: { parent: { select: { user: { select: { firstName: true, lastName: true } } } } } },
              discharges: { orderBy: { createdAt: 'desc' }, take: 1 },
            },
          },
        },
      }),
    ]);
    return paginate(data, total, page, limit);
  }

  /** All discharge records of a student (leaving certificates), newest first, with the certificate fields. */
  async studentDischarges(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        studentProfile: {
          select: {
            admissionNo: true,
            admissionDate: true,
            religion: true,
            parents: { where: { relation: 'FATHER' }, take: 1, select: { parent: { select: { user: { select: { firstName: true, lastName: true } } } } } },
            discharges: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });
    if (!u?.studentProfile) throw new NotFoundException('Student not found');
    return u;
  }

}
