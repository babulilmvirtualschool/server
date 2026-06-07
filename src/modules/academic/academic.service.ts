import { Injectable, NotFoundException } from '@nestjs/common';
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
  UpdateEnrollmentDto,
} from './dto/enrollment.dto';

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
      include: { classTeacher: { include: { user: true } } },
    });
  }
  async getSection(id: string) {
    const section = await this.prisma.section.findUnique({
      where: { id },
      include: {
        class: true,
        classTeacher: { include: { user: true } },
        enrollments: { include: { student: { include: { user: true } } } },
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
        teacher: { include: { user: true } },
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
              include: { student: { include: { user: true } } },
            },
          },
        },
        teacher: { include: { user: true } },
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
        teacher: { include: { user: true } },
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
  createEnrollment(dto: CreateEnrollmentDto) {
    return this.prisma.studentEnrollment.create({ data: dto });
  }

  listEnrollments(sectionId?: string, academicYearId?: string) {
    return this.prisma.studentEnrollment.findMany({
      where: {
        ...(sectionId ? { sectionId } : {}),
        ...(academicYearId ? { academicYearId } : {}),
      },
      include: {
        student: { include: { user: true } },
        section: { include: { class: true } },
      },
      orderBy: { rollNumber: 'asc' },
    });
  }

  updateEnrollment(id: string, dto: UpdateEnrollmentDto) {
    return this.prisma.studentEnrollment.update({ where: { id }, data: dto });
  }

  deleteEnrollment(id: string) {
    return this.prisma.studentEnrollment.delete({ where: { id } });
  }
}
