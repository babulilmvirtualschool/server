import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AcademicYearStatus, Campus, ContentProgress, Role } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
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
  PromoteStudentsDto,
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
      if (new Date(dto.endDate) <= new Date(dto.startDate)) {
        throw new BadRequestException({ message: 'The end date must be after the start date.', fields: { endDate: 'Must be after the start date' } });
      }
      if (dto.isCurrent && dto.status === AcademicYearStatus.ARCHIVED) {
        throw new BadRequestException({ message: 'An archived year can\'t be the current year.', fields: { status: 'Current year must be Active' } });
      }
      return tx.academicYear.create({
        data: {
          name: dto.name,
          code: dto.code?.trim() || null,
          status: dto.status ?? AcademicYearStatus.ACTIVE,
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
    const existing = await this.prisma.academicYear.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Academic year not found');
    const status = dto.status ?? existing.status;
    const isCurrent = dto.isCurrent ?? existing.isCurrent;
    if (isCurrent && status === AcademicYearStatus.ARCHIVED) {
      throw new BadRequestException({ message: 'The current year can\'t be archived. Make another year current first.', fields: { status: 'Current year must be Active' } });
    }
    const start = dto.startDate ? new Date(dto.startDate) : existing.startDate;
    const end = dto.endDate ? new Date(dto.endDate) : existing.endDate;
    if (end <= start) {
      throw new BadRequestException({ message: 'The end date must be after the start date.', fields: { endDate: 'Must be after the start date' } });
    }
    return this.prisma.$transaction(async (tx) => {
      if (dto.isCurrent) {
        await tx.academicYear.updateMany({ data: { isCurrent: false } });
      }
      return tx.academicYear.update({
        where: { id },
        data: {
          ...dto,
          ...(dto.code !== undefined ? { code: dto.code?.trim() || null } : {}),
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
  private checkMarks(total?: number | null, passing?: number | null) {
    if (total != null && passing != null && passing > total) {
      throw new BadRequestException({ message: 'Passing marks can\'t be more than total marks.', fields: { passingMarks: 'More than total marks' } });
    }
  }

  createSubject(dto: CreateSubjectDto) {
    this.checkMarks(dto.totalMarks, dto.passingMarks);
    return this.prisma.subject.create({ data: { ...dto, code: dto.code?.trim() || null } });
  }
  listSubjects() {
    return this.prisma.subject.findMany({ orderBy: { name: 'asc' } });
  }
  async updateSubject(id: string, dto: UpdateSubjectDto) {
    const s = await this.prisma.subject.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Subject not found');
    this.checkMarks(dto.totalMarks !== undefined ? dto.totalMarks : s.totalMarks, dto.passingMarks !== undefined ? dto.passingMarks : s.passingMarks);
    return this.prisma.subject.update({
      where: { id },
      data: { ...dto, ...(dto.code !== undefined ? { code: dto.code?.trim() || null } : {}) },
    });
  }
  deleteSubject(id: string) {
    return this.prisma.subject.delete({ where: { id } });
  }

  // -------- Courses --------
  /** Admin: any teacher. Teacher ("My Course → Add course"): always themselves; deleting stays admin-only. */
  async createCourse(dto: CreateCourseDto, user: AuthUser) {
    let teacherId = dto.teacherId;
    if (user.role === Role.TEACHER) {
      const me = await this.prisma.teacherProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
      if (!me) throw new ForbiddenException('Teacher profile not found');
      teacherId = me.id;
    } else {
      if (!teacherId) throw new BadRequestException({ message: 'Choose a teacher.', fields: { teacherId: 'Required' } });
      const t = await this.prisma.teacherProfile.findFirst({ where: { id: teacherId, user: { role: Role.TEACHER } }, select: { id: true } });
      if (!t) throw new BadRequestException({ message: 'Teacher not found', fields: { teacherId: 'Choose a teacher' } });
    }
    await this.assertSectionInYear(dto.sectionId, dto.academicYearId);
    const exists = await this.prisma.course.findFirst({
      where: { subjectId: dto.subjectId, sectionId: dto.sectionId, academicYearId: dto.academicYearId },
      select: { id: true },
    });
    if (exists) {
      throw new ConflictException({ message: 'This class already has this subject.', fields: { subjectId: 'Already added for this class' } });
    }
    return this.prisma.course.create({ data: { ...dto, teacherId } });
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
        lessons: { select: { progress: true, topics: { select: { progress: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    }).then((rows) => rows.map(({ lessons, ...c }) => ({ ...c, progress: AcademicService.progressOf(lessons) })));
  }

  /** Lesson-plan progress for the admin: topics (or lessons without topics) by Pending / In progress / Complete. */
  static progressOf(lessons: { progress: ContentProgress; topics: { progress: ContentProgress }[] }[]) {
    const items = lessons.flatMap((l) => (l.topics.length ? l.topics : [l]));
    const count = (p: ContentProgress) => items.filter((i) => i.progress === p).length;
    const complete = count(ContentProgress.COMPLETE);
    return {
      lessons: lessons.length,
      items: items.length,
      complete,
      inProgress: count(ContentProgress.IN_PROGRESS),
      pending: count(ContentProgress.PENDING),
      percent: items.length ? Math.round((complete / items.length) * 100) : 0,
    };
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

  async updateCourse(id: string, dto: UpdateCourseDto) {
    if (dto.teacherId) {
      const t = await this.prisma.teacherProfile.findUnique({ where: { id: dto.teacherId }, select: { id: true } });
      if (!t) throw new BadRequestException({ message: 'Teacher not found', fields: { teacherId: 'Choose a teacher' } });
    }
    return this.prisma.course.update({ where: { id }, data: dto });
  }

  /** What deleting a course would remove; `canDelete` is false while it holds student records (attendance, work, results). */
  async courseDeleteImpact(id: string) {
    const c = await this.prisma.course.findUnique({
      where: { id },
      select: {
        id: true,
        _count: {
          select: { lessons: true, liveClasses: true, assignments: true, quizzes: true, attendance: true, examPapers: true, timetableSlots: true, diaryEntries: true, announcements: true },
        },
      },
    });
    if (!c) throw new NotFoundException('Course not found');
    const [submissions, attempts] = await Promise.all([
      this.prisma.assignmentSubmission.count({ where: { assignment: { courseId: id } } }),
      this.prisma.quizAttempt.count({ where: { quiz: { courseId: id } } }),
    ]);
    const n = c._count;
    const blockers = [
      n.attendance ? `${n.attendance} attendance record(s)` : null,
      submissions ? `${submissions} assignment submission(s)` : null,
      attempts ? `${attempts} online-test attempt(s)` : null,
      n.examPapers ? `${n.examPapers} exam paper(s)` : null,
    ].filter((x): x is string => !!x);
    return { counts: { ...n, submissions, attempts }, canDelete: blockers.length === 0, blockers };
  }

  /** Delete a course with its content, timetable and diary — refused (409) while it holds student records. */
  async deleteCourse(id: string) {
    const impact = await this.courseDeleteImpact(id);
    if (!impact.canDelete) {
      throw new ConflictException(
        `This course has ${impact.blockers.join(', ')} — it can't be deleted. Change its teacher instead.`,
      );
    }
    await this.prisma.course.delete({ where: { id } });
    return { success: true as const };
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
    const rows = await this.prisma.course.findMany({
      where: { teacherId: teacher.id },
      include: {
        subject: true,
        section: { include: { class: true } },
        academicYear: true,
        lessons: { select: { progress: true, topics: { select: { progress: true } } } },
      },
    });
    return rows.map(({ lessons, ...c }) => ({ ...c, progress: AcademicService.progressOf(lessons) }));
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

  /** Current-year class names of one school, ordered by level (public website form). */
  async publicClassNames(campus: Campus) {
    const classes = await this.prisma.class.findMany({
      where: { academicYear: { isCurrent: true, campus } },
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
      select: { name: true },
    });
    return [...new Set(classes.map((c) => c.name))];
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

  /**
   * Promote: the ticked students of a section move to the target section keeping their roll numbers
   * (same year → the enrollment moves; another year → a new enrollment in that year), or are marked Graduated.
   * All-or-nothing: 400 if a student isn't active in the section, 409 on roll / enrollment clashes.
   */
  async promoteStudents(dto: PromoteStudentsDto) {
    if (!!dto.graduate === !!dto.toSectionId) {
      throw new BadRequestException('Choose the next class/section, or Graduated for the final class.');
    }
    const from = await this.prisma.section.findUnique({ where: { id: dto.fromSectionId }, include: { class: true } });
    if (!from) throw new NotFoundException('Section not found');
    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: { sectionId: from.id, status: 'ACTIVE', studentId: { in: dto.studentIds } },
      include: { student: { include: { user: { select: { firstName: true, lastName: true } } } } },
    });
    if (enrollments.length !== dto.studentIds.length) {
      throw new BadRequestException('Some selected students are not active in this class any more. Reload the list.');
    }
    const name = (e: (typeof enrollments)[number]) => `${e.student.user.firstName} ${e.student.user.lastName}`.trim();

    if (dto.graduate) {
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.studentEnrollment.updateMany({ where: { id: { in: enrollments.map((e) => e.id) } }, data: { status: 'GRADUATED' } }),
        this.prisma.studentProfile.updateMany({ where: { id: { in: dto.studentIds } }, data: { graduatedAt: now } }),
      ]);
      return { graduated: enrollments.length, promoted: 0 };
    }

    const to = await this.prisma.section.findUnique({ where: { id: dto.toSectionId! }, include: { class: true } });
    if (!to) throw new NotFoundException('Target section not found');
    if (to.id === from.id) throw new BadRequestException('Choose a different class to promote to.');
    const sameYear = to.class.academicYearId === from.class.academicYearId;

    if (!sameYear) {
      const already = await this.prisma.studentEnrollment.findMany({
        where: { academicYearId: to.class.academicYearId, studentId: { in: dto.studentIds } },
        include: { section: { include: { class: true } } },
      });
      if (already.length) {
        const names = already.map((a) => {
          const e = enrollments.find((x) => x.studentId === a.studentId)!;
          return `${name(e)} (${a.section.class.name} ${a.section.name})`;
        });
        throw new ConflictException(`Already enrolled in that academic year: ${names.join(', ')}.`);
      }
    }
    const taken = await this.prisma.studentEnrollment.findMany({
      where: { sectionId: to.id, ...(sameYear ? { id: { notIn: enrollments.map((e) => e.id) } } : {}) },
      select: { rollNumber: true },
    });
    const used = new Set(taken.map((t) => t.rollNumber));
    const clashes = enrollments.filter((e) => used.has(e.rollNumber)).map((e) => `${name(e)} (roll ${e.rollNumber})`);
    if (clashes.length) {
      throw new ConflictException(`Roll number already used in ${to.class.name} ${to.name}: ${clashes.join(', ')}. Change their roll numbers first.`);
    }
    await this.prisma.$transaction(
      enrollments.map((e) =>
        sameYear
          ? this.prisma.studentEnrollment.update({ where: { id: e.id }, data: { sectionId: to.id } })
          : this.prisma.studentEnrollment.create({
              data: { studentId: e.studentId, sectionId: to.id, academicYearId: to.class.academicYearId, rollNumber: e.rollNumber },
            }),
      ),
    );
    return { promoted: enrollments.length, graduated: 0 };
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
