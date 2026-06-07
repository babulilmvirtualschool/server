import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import {
  AdmissionApplicationStatus,
  Gender,
  ParentRelation,
  Prisma,
  Role,
  TeacherApplicationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateAdminDto,
  CreateParentDto,
  CreateStudentDto,
  CreateTeacherDto,
  ParentChildLinkDto,
} from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { CreateStudentWithParentsDto } from './dto/create-student-with-parents.dto';
import { getSkipTake, paginate } from '../../common/pagination/pagination.dto';
import {
  baseUsernameFromNames,
  isValidUsernameFormat,
} from '../../common/utils/username.util';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private async hashPassword(raw: string) {
    return bcrypt.hash(raw, 12);
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
      studentProfile: {
        select: {
          admissionNo: true,
        },
      },
      parentProfile: {
        select: {
          cnic: true,
          occupation: true,
          _count: { select: { children: true } },
        },
      },
      teacherProfile: {
        select: {
          id: true,
          employeeCode: true,
          qualification: true,
          specialization: true,
        },
      },
      adminProfile: {
        select: {
          title: true,
        },
      },
    };
  }

  async list(query: ListUsersDto) {
    const { skip, take, page, limit } = getSkipTake(query);
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
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
        orderBy: { createdAt: 'desc' },
        select: this.listUserSelect(),
      }),
    ]);
    return paginate(data, total, page, limit);
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
      return { ...user, parentLinks };
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

  async createAdmin(dto: CreateAdminDto) {
    this.assertEmailOrUsername(dto);
    const passwordHash = await this.hashPassword(dto.password);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        username: dto.username,
        phone: dto.phone,
        passwordHash,
        role: Role.ADMIN,
        firstName: dto.firstName,
        lastName: dto.lastName,
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        avatarKey: dto.avatarKey,
        adminProfile: { create: { title: dto.title } },
      },
      select: this.userSelect(),
    });
  }

  async createTeacher(dto: CreateTeacherDto) {
    this.assertEmailOrUsername(dto);
    const passwordHash = await this.hashPassword(dto.password);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        username: dto.username,
        phone: dto.phone,
        passwordHash,
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
          },
        },
      },
      select: this.userSelect(),
    });
  }

  async createStudent(dto: CreateStudentDto) {
    this.assertEmailOrUsername(dto);
    const passwordHash = await this.hashPassword(dto.password);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        username: dto.username,
        phone: dto.phone,
        passwordHash,
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
    const passwordHash = await this.hashPassword(dto.password);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          username: dto.username,
          phone: dto.phone,
          passwordHash,
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
    const passwordHash = await this.hashPassword(rawPassword);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
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
      this.prisma.mediaAsset.count({ where: { uploaderId: id } }),
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
      await this.prisma.user.delete({ where: { id } });
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
      fatherPasswordHash: string;
      motherPasswordHash: string;
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
            emergencyPhone:
              params.fatherPhone ||
              params.motherPhone ||
              params.studentPhone,
          },
        },
      },
      include: { studentProfile: true },
    });

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
        passwordHash: params.fatherPasswordHash,
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
        passwordHash: params.motherPasswordHash,
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
    const fatherName = dto.fatherName.trim();
    const motherName = dto.motherName.trim();
    if (!fatherName || !motherName) {
      throw new BadRequestException('Father and mother names are required.');
    }

    const studentEmail = dto.studentAccountEmail?.trim()
      ? dto.studentAccountEmail.trim().toLowerCase()
      : null;
    const su = dto.studentUsername.trim().toLowerCase();
    const fu = dto.fatherUsername.trim().toLowerCase();
    const mu = dto.motherUsername.trim().toLowerCase();

    await this.assertProvisionIdentifiersFree(su, fu, mu, studentEmail);

    const addressExtras = [
      `Class: ${dto.gradeLevel.trim()}`,
      `Curriculum: ${dto.curriculum.trim()}`,
      `Shift: ${dto.preferredShift.trim().toLowerCase()} shift`,
      dto.studentBFormNo?.trim() ? `B-Form: ${dto.studentBFormNo.trim()}` : null,
      dto.guardianName?.trim()
        ? `Guardian: ${dto.guardianName.trim()}${dto.guardianRelation?.trim() ? ` (${dto.guardianRelation.trim()})` : ''}${dto.guardianPhone?.trim() ? ` · ${dto.guardianPhone.trim()}` : ''}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    const city = dto.city.trim();
    const studentAddress = addressExtras ? `${city}\n\n${addressExtras}` : city;

    const [studentPasswordHash, fatherPasswordHash, motherPasswordHash] =
      await Promise.all([
        this.hashPassword(dto.studentPassword),
        this.hashPassword(dto.fatherPassword),
        this.hashPassword(dto.motherPassword),
      ]);

    const studentDob = dto.dateOfBirth
      ? new Date(dto.dateOfBirth)
      : null;

    const { studentUserId } = await this.prisma.$transaction(
      async (tx) => {
        return this.provisionFamilyAccountsInTransaction(tx, {
          studentFirstName: dto.firstName.trim(),
          studentLastName: dto.lastName.trim(),
          studentGender: dto.gender ?? null,
          studentDateOfBirth: studentDob,
          studentPhone: dto.phone.trim(),
          studentAddress,
          bloodGroup: dto.bloodGroup?.trim() || null,
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
          parentAddressLine: city,
        });
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    return this.findById(studentUserId);
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
    },
  ): Promise<{ accountsProvisioned: boolean }> {
    const app = await this.prisma.admissionApplication.findUnique({
      where: { id: applicationId },
    });
    if (!app) throw new NotFoundException('Admission application not found');
    if (app.studentUserId) {
      return { accountsProvisioned: false };
    }

    const fatherName = app.fatherName?.trim();
    const motherName = app.motherName?.trim();
    if (!fatherName || !motherName) {
      throw new BadRequestException(
        'Father and mother names are required on the application before approval can create accounts.',
      );
    }

    const studentEmail = accounts.studentEmail;
    const su = accounts.studentUsername.trim().toLowerCase();
    const fu = accounts.fatherUsername.trim().toLowerCase();
    const mu = accounts.motherUsername.trim().toLowerCase();

    await this.assertProvisionIdentifiersFree(su, fu, mu, studentEmail);

    const [studentPasswordHash, fatherPasswordHash, motherPasswordHash] =
      await Promise.all([
        this.hashPassword(accounts.studentPassword),
        this.hashPassword(accounts.fatherPassword),
        this.hashPassword(accounts.motherPassword),
      ]);

    const city = app.city.trim();

    await this.prisma.$transaction(
      async (tx) => {
        const { studentUserId } = await this.provisionFamilyAccountsInTransaction(
          tx,
          {
            studentFirstName: app.firstName.trim(),
            studentLastName: app.lastName.trim(),
            studentGender: null,
            studentDateOfBirth: app.dateOfBirth,
            studentPhone: app.phone.trim(),
            studentAddress: city,
            bloodGroup: null,
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
            parentAddressLine: city,
          },
        );

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

  private async allocateAdmissionNo(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const suffix = randomBytes(3).toString('hex').toUpperCase();
      const candidate = `ADM-${new Date().getFullYear()}-${suffix}`;
      const exists = await tx.studentProfile.findUnique({
        where: { admissionNo: candidate },
      });
      if (!exists) return candidate;
    }
    throw new Error('Could not allocate admission number');
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

    const passwordHash = await this.hashPassword(accounts.teacherPassword.trim());
    const tu = accounts.teacherUsername.trim().toLowerCase();
    const bioParts = [
      app.teachingExperience.trim(),
      app.currentWorkplace
        ? `Workplace: ${app.currentWorkplace.trim()}`
        : null,
    ].filter(Boolean);
    const bio = bioParts.length ? bioParts.join(' · ') : null;

    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: app.email.trim().toLowerCase(),
            username: tu,
            phone: app.phone.trim(),
            passwordHash,
            role: Role.TEACHER,
            firstName: app.firstName.trim(),
            lastName: app.lastName.trim(),
            teacherProfile: {
              create: {
                employeeCode: accounts.employeeCode.trim(),
                qualification: app.highestQualification,
                specialization: app.subjectExpertise,
                joiningDate: new Date(),
                cnic: app.cnic.trim(),
                bio,
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
}
