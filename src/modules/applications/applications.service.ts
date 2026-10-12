import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdmissionApplicationStatus,
  Campus,
  TeacherApplicationStatus,
} from '@prisma/client';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma/prisma.service';
import { R2Service } from '../media/r2.service';
import { UsersService } from '../users/users.service';
import { CreateAdmissionApplicationDto } from './dto/create-admission-application.dto';
import { CreateManualAdmissionDto } from './dto/create-manual-admission.dto';
import { CreateManualTeacherApplicationDto } from './dto/create-manual-teacher-application.dto';
import { CreateTeacherApplicationDto } from './dto/create-teacher-application.dto';
import { ListAdmissionApplicationsDto } from './dto/list-admission-applications.dto';
import { ListTeacherApplicationsDto } from './dto/list-teacher-applications.dto';
import { UpdateAdmissionStatusDto } from './dto/update-admission-status.dto';
import { UpdateTeacherApplicationStatusDto } from './dto/update-teacher-status.dto';
import {
  MAX_CV_BYTES,
  TeacherCvPresignDto,
} from './dto/teacher-cv-presign.dto';
import { getSkipTake, paginate } from '../../common/pagination/pagination.dto';

const CV_KEY_PREFIX = 'applications/teacher-cv/';
const ALLOWED_CV_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly r2: R2Service,
  ) {}

  private sanitizeExt(name?: string) {
    if (!name) return '';
    const m = /\.[A-Za-z0-9]{1,8}$/.exec(name);
    return m ? m[0].toLowerCase() : '';
  }

  private assertValidCvKey(key?: string | null) {
    if (!key) return;
    if (!key.startsWith(CV_KEY_PREFIX)) {
      throw new BadRequestException('Invalid CV storage key');
    }
  }

  private assertCvMime(mimeType: string, originalName?: string) {
    if (ALLOWED_CV_MIME.has(mimeType)) return mimeType;
    const ext = this.sanitizeExt(originalName);
    const byExt: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    if (ext && byExt[ext]) return byExt[ext];
    throw new BadRequestException(
      'CV must be PDF or Word (.pdf, .doc, .docx)',
    );
  }

  private buildCvStorageKey(originalName?: string) {
    const ext = this.sanitizeExt(originalName);
    return `${CV_KEY_PREFIX}${Date.now()}-${nanoid(10)}${ext}`;
  }

  /** Public presign for faculty application CV upload (browser PUT to R2). */
  async presignTeacherCv(dto: TeacherCvPresignDto) {
    const mimeType = this.assertCvMime(dto.mimeType, dto.originalName);
    if (dto.size > MAX_CV_BYTES) {
      throw new BadRequestException('CV must be 10 MB or smaller');
    }
    const key = this.buildCvStorageKey(dto.originalName);
    const uploadUrl = await this.r2.presignPut({
      key,
      contentType: mimeType,
    });
    return {
      key,
      uploadUrl,
      expiresIn: this.r2.presignExpiresSeconds,
    };
  }

  /** Admin download link for a stored teacher application CV. */
  async presignTeacherCvDownload(applicationId: string) {
    const app = await this.prisma.teacherApplication.findUnique({
      where: { id: applicationId },
      select: { cvKey: true, cvOriginalName: true },
    });
    if (!app) throw new NotFoundException('Application not found');
    if (!app.cvKey) {
      throw new NotFoundException('No CV file uploaded for this application');
    }
    const url = await this.r2.presignGet(app.cvKey);
    return {
      key: app.cvKey,
      url,
      originalName: app.cvOriginalName,
      expiresIn: this.r2.presignExpiresSeconds,
    };
  }

  async createAdmission(dto: CreateAdmissionApplicationDto) {
    const emailRaw = dto.email?.trim();
    return this.prisma.admissionApplication.create({
      data: {
        // Website form choice; on admin routes the campus middleware replaces it with the admin's school.
        campus: dto.campus ?? Campus.ONLINE,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone.trim(),
        email: emailRaw ? emailRaw.toLowerCase() : null,
        city: dto.city.trim(),
        dateOfBirth: dto.dateOfBirth
          ? new Date(dto.dateOfBirth)
          : null,
        fatherName: dto.fatherName?.trim() || null,
        fatherCnic: dto.fatherCnic?.trim() || null,
        fatherPhone: dto.fatherPhone?.trim() || null,
        motherName: dto.motherName?.trim() || null,
        motherCnic: dto.motherCnic?.trim() || null,
        motherPhone: dto.motherPhone?.trim() || null,
        guardianName: dto.guardianName?.trim() || null,
        guardianRelation: dto.guardianRelation?.trim() || null,
        guardianPhone: dto.guardianPhone?.trim() || null,
        gradeLevel: dto.gradeLevel.trim(),
        curriculum: dto.curriculum.trim(),
        preferredShift: dto.preferredShift.trim().toLowerCase(),
        studentBFormNo: dto.studentBFormNo?.trim() || null,
      },
    });
  }

  /**
   * Admin "Pending Enrolled": saves the Add student form as a PENDING admission (no accounts yet).
   * Father and mother names are required because approval creates their accounts.
   */
  async createManualAdmission(dto: CreateManualAdmissionDto) {
    const sibling = dto.siblingOfStudentId ? await this.users.siblingFamily(dto.siblingOfStudentId) : null;
    const fields: Record<string, string> = {};
    if (!sibling && !dto.fatherName?.trim()) fields.fatherName = 'Required';
    if (!sibling && !dto.motherName?.trim()) fields.motherName = 'Required';
    if (!dto.dateOfBirth) fields.dateOfBirth = 'Required';
    if (Object.keys(fields).length) {
      throw new BadRequestException({ message: 'Father name, mother name and date of birth are required.', fields });
    }
    const target = await this.users.resolveEnrollmentTarget(dto.sectionId, dto.rollNumber);
    const { gender, bloodGroup, sectionId: _s, rollNumber: _r, siblingOfStudentId, ...base } = dto;
    if (sibling) {
      // Show the existing family on the application; approval links these parent accounts.
      Object.assign(base, {
        fatherName: sibling.fatherName ?? undefined,
        fatherPhone: sibling.father?.user.phone ?? undefined,
        fatherCnic: sibling.father?.cnic ?? undefined,
        motherName: sibling.motherName ?? undefined,
        motherPhone: sibling.mother?.user.phone ?? undefined,
        motherCnic: sibling.mother?.cnic ?? undefined,
      });
    }
    const created = await this.createAdmission(base);
    return this.prisma.admissionApplication.update({
      where: { id: created.id },
      data: {
        gender: gender ?? null,
        bloodGroup: bloodGroup?.trim() || null,
        sectionId: target?.sectionId ?? null,
        rollNumber: target?.rollNumber ?? null,
        siblingOfStudentId: sibling ? siblingOfStudentId : null,
      },
      include: { section: { select: { id: true, name: true, class: { select: { name: true } } } } },
    });
  }

  async createTeacher(dto: CreateTeacherApplicationDto) {
    const emailRaw = dto.email?.trim();
    const cvKey = dto.cvKey?.trim() || null;
    this.assertValidCvKey(cvKey);
    return this.prisma.teacherApplication.create({
      data: {
        // Website form choice; on admin routes the campus middleware replaces it with the admin's school.
        campus: dto.campus ?? Campus.ONLINE,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone.trim(),
        email: emailRaw.toLowerCase(),
        city: dto.city.trim(),
        cnic: dto.cnic.trim(),
        subjectExpertise: dto.subjectExpertise.trim(),
        highestQualification: dto.highestQualification.trim(),
        teachingExperience: dto.teachingExperience.trim(),
        currentWorkplace: dto.currentWorkplace?.trim() || null,
        cvKey,
        cvOriginalName: dto.cvOriginalName?.trim() || null,
      },
    });
  }

  /** Admin "Pending Enrolled" from Add teacher: saved as a PENDING faculty application (no account yet). */
  async createManualTeacher(dto: CreateManualTeacherApplicationDto) {
    const { gender, dateOfBirth, joiningDate, bio, ...base } = dto;
    const created = await this.createTeacher(base);
    return this.prisma.teacherApplication.update({
      where: { id: created.id },
      data: {
        gender: gender ?? null,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        joiningDate: joiningDate ? new Date(joiningDate) : null,
        bio: bio?.trim() || null,
      },
    });
  }

  async listTeachers(query: ListTeacherApplicationsDto) {
    const { skip, take, page, limit } = getSkipTake(query);
    const where = query.search
      ? {
          OR: [
            {
              firstName: {
                contains: query.search,
                mode: 'insensitive' as const,
              },
            },
            {
              lastName: { contains: query.search, mode: 'insensitive' as const },
            },
            { email: { contains: query.search, mode: 'insensitive' as const } },
            { phone: { contains: query.search, mode: 'insensitive' as const } },
            { city: { contains: query.search, mode: 'insensitive' as const } },
            {
              subjectExpertise: {
                contains: query.search,
                mode: 'insensitive' as const,
              },
            },
            { cnic: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [total, data] = await this.prisma.$transaction([
      this.prisma.teacherApplication.count({ where }),
      this.prisma.teacherApplication.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return paginate(data, total, page, limit);
  }

  async updateTeacherStatus(id: string, dto: UpdateTeacherApplicationStatusDto) {
    const { status, teacherPassword, teacherUsername, employeeCode } = dto;

    if (status === 'REJECTED') {
      try {
        const updated = await this.prisma.teacherApplication.update({
          where: { id },
          data: { status: TeacherApplicationStatus.REJECTED },
        });
        return { data: updated, meta: { accountsProvisioned: false } };
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code;
        if (code === 'P2025') {
          throw new NotFoundException('Teacher application not found');
        }
        throw e;
      }
    }

    const existing = await this.prisma.teacherApplication.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Teacher application not found');
    }

    if (existing.teacherUserId) {
      const updated = await this.prisma.teacherApplication.update({
        where: { id },
        data: { status: TeacherApplicationStatus.APPROVED },
      });
      return { data: updated, meta: { accountsProvisioned: false } };
    }

    if (!teacherPassword?.trim()) {
      throw new BadRequestException(
        'When approving a new teacher, teacherPassword is required (min. 8 characters).',
      );
    }

    if (!teacherUsername?.trim() || !employeeCode?.trim()) {
      throw new BadRequestException({
        message:
          'teacherUsername and employeeCode are required when creating the teacher account.',
        fields: {
          ...(teacherUsername?.trim()
            ? {}
            : { teacherUsername: 'Choose a login username.' }),
          ...(employeeCode?.trim()
            ? {}
            : { employeeCode: 'Set an employee code.' }),
        },
      });
    }

    const { accountsProvisioned } =
      await this.users.provisionTeacherFromApprovedApplication(id, {
        teacherUsername: teacherUsername.trim(),
        teacherPassword: teacherPassword.trim(),
        employeeCode: employeeCode.trim(),
      });

    const updated = await this.prisma.teacherApplication.findUniqueOrThrow({
      where: { id },
    });
    return { data: updated, meta: { accountsProvisioned } };
  }

  async listAdmissions(query: ListAdmissionApplicationsDto) {
    const { skip, take, page, limit } = getSkipTake(query);
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' as const } },
              { lastName: { contains: query.search, mode: 'insensitive' as const } },
              { email: { contains: query.search, mode: 'insensitive' as const } },
              { phone: { contains: query.search, mode: 'insensitive' as const } },
              { city: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.admissionApplication.count({ where }),
      this.prisma.admissionApplication.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          section: { select: { id: true, name: true, class: { select: { name: true } } } },
          siblingOf: { select: { id: true, admissionNo: true, user: { select: { firstName: true, lastName: true } } } },
        },
      }),
    ]);
    return paginate(data, total, page, limit);
  }

  async suggestUsernamesForAdmission(id: string) {
    return this.users.suggestUsernamesForAdmission(id);
  }

  suggestProvisionForTeacherApplication(id: string) {
    return this.users.suggestProvisionForTeacherApplication(id);
  }

  async updateAdmissionStatus(id: string, dto: UpdateAdmissionStatusDto) {
    const {
      status,
      studentPassword,
      fatherPassword,
      motherPassword,
      studentUsername,
      fatherUsername,
      motherUsername,
      studentEmail,
      sectionId,
      rollNumber,
    } = dto;

    if (status === 'REJECTED') {
      try {
        const updated = await this.prisma.admissionApplication.update({
          where: { id },
          data: { status: AdmissionApplicationStatus.REJECTED },
        });
        return { data: updated, meta: { accountsProvisioned: false } };
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code;
        if (code === 'P2025') {
          throw new NotFoundException('Admission application not found');
        }
        throw e;
      }
    }

    const existing = await this.prisma.admissionApplication.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Admission application not found');
    }

    if (existing.studentUserId) {
      const updated = await this.prisma.admissionApplication.update({
        where: { id },
        data: { status: AdmissionApplicationStatus.APPROVED },
      });
      return { data: updated, meta: { accountsProvisioned: false } };
    }

    // Sibling admissions link existing parents: only the student's login is needed.
    const sibling = !!existing.siblingOfStudentId;
    if (
      !studentPassword?.trim() ||
      (!sibling && (!fatherPassword?.trim() || !motherPassword?.trim()))
    ) {
      throw new BadRequestException(
        'When approving, studentPassword, fatherPassword, and motherPassword are required (min. 8 characters each).',
      );
    }

    if (
      !studentUsername?.trim() ||
      (!sibling && (!fatherUsername?.trim() || !motherUsername?.trim()))
    ) {
      throw new BadRequestException({
        message:
          'studentUsername, fatherUsername, and motherUsername are required when creating accounts.',
        fields: {
          ...(studentUsername?.trim()
            ? {}
            : { studentUsername: 'Choose a student username.' }),
          ...(fatherUsername?.trim()
            ? {}
            : { fatherUsername: 'Choose a father account username.' }),
          ...(motherUsername?.trim()
            ? {}
            : { motherUsername: 'Choose a mother account username.' }),
        },
      });
    }

    const studentEmailNorm = studentEmail?.trim()
      ? studentEmail.trim().toLowerCase()
      : null;

    const { accountsProvisioned } =
      await this.users.provisionAccountsForApprovedAdmission(id, {
        studentUsername: studentUsername.trim(),
        fatherUsername: fatherUsername?.trim() ?? '',
        motherUsername: motherUsername?.trim() ?? '',
        studentEmail: studentEmailNorm,
        studentPassword: studentPassword.trim(),
        fatherPassword: fatherPassword?.trim() ?? '',
        motherPassword: motherPassword?.trim() ?? '',
        sectionId: sectionId || null,
        rollNumber: rollNumber?.trim() || null,
      });

    const updated = await this.prisma.admissionApplication.findUniqueOrThrow({
      where: { id },
    });
    return { data: updated, meta: { accountsProvisioned } };
  }
}
