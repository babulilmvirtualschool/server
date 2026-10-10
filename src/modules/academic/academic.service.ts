import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateAcademicYearDto,
  UpdateAcademicYearDto,
} from './dto/academic-year.dto';
import { CreateClassDto, UpdateClassDto } from './dto/class.dto';
import { CreateSectionDto, UpdateSectionDto } from './dto/section.dto';
import { CreateSubjectDto, UpdateSubjectDto } from './dto/subject.dto';
import { CreateCourseDto, UpdateCourseDto } from './dto/course.dto';
import {
  CreateEnrollmentDto,
  ShiftEnrollmentsDto,
  UpdateEnrollmentDto,
} from './dto/enrollment.dto';
import { publicUserSelect } from '../../common/utils/public-user.select';

@Injectable()
export class AcademicService {
  constructor(private readonly prisma: PrismaService) {}

  async createYear(dto: CreateAcademicYearDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isCurrent) {
        await tx.academicYear.updateMany({ data: { isCurrent: false } });
      }
      return tx.academicYear.create({
        data: {
          name: dto.name,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          isCurrent: dto.isCurrent ?? false,
        },
      });
    });
  }

  listYears() {
    return this.prisma.academicYear.findMany({
      orderBy: { startDate: 'desc' },
    });
  }

  getCurrentYear() {
    return this.prisma.academicYear.findFirst({ where: { isCurrent: true } });
  }

  async updateYear(id: string, dto: UpdateAcademicYearDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isCurrent) {
        await tx.academicYear.updateMany({ data: { isCurrent: false } });
      }
      return tx.academicYear.update({
        where: { id },
        data: {
          ...dto,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        },
      });
    });
  }

  deleteYear(id: string) {
    return this.prisma.academicYear.delete({ where: { id } });
  }

  // -------- Classes --------
  createClass(dto: CreateClassDto) {
    return this.prisma.class.create({ data: dto });
  }
  listClasses(academicYearId?: string) {
    return this.prisma.class.findMany({
      where: academicYearId ? { academicYearId } : undefined,
      orderBy: [{ academicYearId: 'desc' }, { level: 'asc' }],
      include: { sections: true },
    });
  }
  updateClass(id: string, dto: UpdateClassDto) {
    return this.prisma.class.update({ where: { id }, data: dto });
  }
  deleteClass(id: string) {
    return this.prisma.class.delete({ where: { id } });
  }

  // -------- Sections --------
  createSection(dto: CreateSectionDto) {
    return this.prisma.section.create({ data: dto });
  }
  listSections(classId?: string) {
    return this.prisma.section.findMany({
      where: classId ? { classId } : undefined,
      include: { classTeacher: { include: { user: { select: publicUserSelect } } } },
    });
  }
  async getSection(id: string) {
    const section = await this.prisma.section.findUnique({
      where: { id },
      include: {
        class: true,
        classTeacher: { include: { user: { select: publicUserSelect } } },
        enrollments: { include: { student: { include: { user: { select: publicUserSelect } } } } },
      },
    });
    if (!section) throw new NotFoundException('Section not found');
    return section;
  }
  updateSection(id: string, dto: UpdateSectionDto) {
    return this.prisma.section.update({ where: { id }, data: dto });
  }
  deleteSection(id: string) {
    return this.prisma.section.delete({ where: { id } });
  }

  // -------- Subjects --------
  createSubject(dto: CreateSubjectDto) {
    return this.prisma.subject.create({ data: dto });
  }
  listSubjects() {
    return this.prisma.subject.findMany({ orderBy: { name: 'asc' } });
  }
  updateSubject(id: string, dto: UpdateSubjectDto) {
    return this.prisma.subject.update({ where: { id }, data: dto });
  }
  deleteSubject(id: string) {
    return this.prisma.subject.delete({ where: { id } });
  }

  // -------- Courses --------
  createCourse(dto: CreateCourseDto) {
    return this.prisma.course.create({ data: dto });
  }

  listCourses(filters: {
    sectionId?: string;
    teacherId?: string;
    academicYearId?: string;
    subjectId?: string;
  }) {
    return this.prisma.course.findMany({
      where: {
        ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
        ...(filters.teacherId ? { teacherId: filters.teacherId } : {}),
        ...(filters.academicYearId
          ? { academicYearId: filters.academicYearId }
          : {}),
        ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
      },
      include: {
        subject: true,
        section: { include: { class: true } },
        teacher: { include: { user: { select: publicUserSelect } } },
        academicYear: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCourse(id: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        subject: true,
        section: {
          include: {
            class: true,
            enrollments: {
              include: { student: { include: { user: { select: publicUserSelect } } } },
            },
          },
        },
        teacher: { include: { user: { select: publicUserSelect } } },
        academicYear: true,
      },
    });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  updateCourse(id: string, dto: UpdateCourseDto) {
    return this.prisma.course.update({ where: { id }, data: dto });
  }

  deleteCourse(id: string) {
    return this.prisma.course.delete({ where: { id } });
  }

  /** Courses for a student (via their enrollment in a Section). */
  async coursesForStudentUser(studentUserId: string, academicYearId?: string) {
    const student = await this.prisma.studentProfile.findUnique({
      where: { userId: studentUserId },
      include: { enrollments: true },
    });
    if (!student) throw new NotFoundException('Student profile not found');

    const enrollments = academicYearId
      ? student.enrollments.filter((e) => e.academicYearId === academicYearId)
      : student.enrollments;

    const sectionIds = enrollments.map((e) => e.sectionId);
    if (sectionIds.length === 0) return [];

    return this.prisma.course.findMany({
      where: { sectionId: { in: sectionIds } },
      include: {
        subject: true,
        section: { include: { class: true } },
        teacher: { include: { user: { select: publicUserSelect } } },
      },
    });
  }

  /** Courses that a teacher is assigned to. */
  async coursesForTeacherUser(teacherUserId: string) {
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { userId: teacherUserId },
    });
    if (!teacher) throw new NotFoundException('Teacher profile not found');
    return this.prisma.course.findMany({
      where: { teacherId: teacher.id },
      include: {
        subject: true,
        section: { include: { class: true } },
        academicYear: true,
      },
    });
  }

  // -------- Enrollments --------
  /** Enrollment is what gives a student access to their section's courses and content. */
  async createEnrollment(dto: CreateEnrollmentDto) {
    await this.assertSectionInYear(dto.sectionId, dto.academicYearId);
    const student = await this.prisma.studentProfile.findUnique({
      where: { id: dto.studentId },
    });
    if (!student) throw new NotFoundException('Student not found');
    const existing = await this.prisma.studentEnrollment.findUnique({
      where: {
        studentId_academicYearId: {
          studentId: dto.studentId,
          academicYearId: dto.academicYearId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        'This student is already enrolled for this academic year. Change the existing enrollment instead.',
      );
    }
    const rollNumber = dto.rollNumber.trim();
    await this.assertRollNumberFree(dto.sectionId, rollNumber);
    return this.prisma.studentEnrollment.create({
      data: { ...dto, rollNumber },
      include: { section: { include: { class: true } }, academicYear: true },
    });
  }

  private async assertSectionInYear(sectionId: string, academicYearId: string) {
    const section = await this.prisma.section.findUnique({
      where: { id: sectionId },
      include: { class: true },
    });
    if (!section) throw new NotFoundException('Section not found');
    if (section.class.academicYearId !== academicYearId) {
      throw new BadRequestException(
        'This class/section belongs to a different academic year',
      );
    }
  }

  private async assertRollNumberFree(
    sectionId: string,
    rollNumber: string,
    excludeEnrollmentId?: string,
  ) {
    if (!rollNumber) {
      throw new BadRequestException({
        message: 'Roll number is required',
        fields: { rollNumber: 'Required' },
      });
    }
    const taken = await this.prisma.studentEnrollment.findFirst({
      where: {
        sectionId,
        rollNumber,
        ...(excludeEnrollmentId ? { id: { not: excludeEnrollmentId } } : {}),
      },
    });
    if (taken) {
      throw new ConflictException({
        message: `Roll number ${rollNumber} is already used in this section`,
        fields: { rollNumber: 'Already used in this section' },
      });
    }
  }

  listEnrollments(
    sectionId?: string,
    academicYearId?: string,
    studentId?: string,
  ) {
    return this.prisma.studentEnrollment.findMany({
      where: {
        ...(sectionId ? { sectionId } : {}),
        ...(academicYearId ? { academicYearId } : {}),
        ...(studentId ? { studentId } : {}),
      },
      include: {
        student: { include: { user: { select: publicUserSelect } } },
        section: { include: { class: true } },
      },
      orderBy: { rollNumber: 'asc' },
    });
  }

  /** Bulk shift: all-or-nothing; refused if any student has no enrollment in that year or a roll number clashes. */
  async shiftEnrollments(dto: ShiftEnrollmentsDto) {
    const section = await this.prisma.section.findUnique({
      where: { id: dto.sectionId },
      include: { class: true },
    });
    if (!section) throw new NotFoundException('Section not found');
    const yearId = section.class.academicYearId;
    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: { studentId: { in: dto.studentIds }, academicYearId: yearId },
      include: { student: { include: { user: { select: { firstName: true, lastName: true } } } } },
    });
    const name = (e: (typeof enrollments)[number]) =>
      `${e.student.user.firstName} ${e.student.user.lastName}`.trim();
    const missing = dto.studentIds.filter((id) => !enrollments.some((e) => e.studentId === id));
    if (missing.length) {
      throw new BadRequestException(
        `${missing.length} selected student(s) are not enrolled in any class for this academic year. Enroll them first.`,
      );
    }
    const moving = enrollments.filter((e) => e.sectionId !== section.id);
    const stayingRolls = await this.prisma.studentEnrollment.findMany({
      where: { sectionId: section.id, id: { notIn: moving.map((e) => e.id) } },
      select: { rollNumber: true },
    });
    const used = new Set(stayingRolls.map((r) => r.rollNumber));
    const clashes: string[] = [];
    for (const e of moving) {
      if (used.has(e.rollNumber)) clashes.push(`${name(e)} (roll ${e.rollNumber})`);
      used.add(e.rollNumber);
    }
    if (clashes.length) {
      throw new ConflictException(
        `Roll number already used in the target section: ${clashes.join(', ')}. Change their roll numbers first.`,
      );
    }
    await this.prisma.$transaction(
      moving.map((e) =>
        this.prisma.studentEnrollment.update({ where: { id: e.id }, data: { sectionId: section.id } }),
      ),
    );
    return { moved: moving.length, alreadyThere: enrollments.length - moving.length };
  }

  async updateEnrollment(id: string, dto: UpdateEnrollmentDto) {
    const existing = await this.prisma.studentEnrollment.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Enrollment not found');
    const sectionId = dto.sectionId ?? existing.sectionId;
    const rollNumber = (dto.rollNumber ?? existing.rollNumber).trim();
    if (dto.sectionId) {
      await this.assertSectionInYear(dto.sectionId, existing.academicYearId);
    }
    if (dto.sectionId !== undefined || dto.rollNumber !== undefined) {
      await this.assertRollNumberFree(sectionId, rollNumber, id);
    }
    return this.prisma.studentEnrollment.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.rollNumber !== undefined ? { rollNumber } : {}),
      },
      include: { section: { include: { class: true } }, academicYear: true },
    });
  }

  deleteEnrollment(id: string) {
    return this.prisma.studentEnrollment.delete({ where: { id } });
  }
}
