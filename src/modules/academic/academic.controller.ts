import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { AcademicService } from './academic.service';
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

@ApiTags('academic')
@ApiBearerAuth()
@Controller()
export class AcademicController {
  constructor(private readonly svc: AcademicService) {}

  // Academic Years
  @Roles(Role.ADMIN)
  @Post('academic-years')
  createYear(@Body() dto: CreateAcademicYearDto) {
    return this.svc.createYear(dto);
  }
  @Get('academic-years')
  listYears() {
    return this.svc.listYears();
  }
  @Get('academic-years/current')
  currentYear() {
    return this.svc.getCurrentYear();
  }
  @Roles(Role.ADMIN)
  @Patch('academic-years/:id')
  updateYear(@Param('id') id: string, @Body() dto: UpdateAcademicYearDto) {
    return this.svc.updateYear(id, dto);
  }
  @Roles(Role.ADMIN)
  @Delete('academic-years/:id')
  deleteYear(@Param('id') id: string) {
    return this.svc.deleteYear(id);
  }

  // Classes
  @Roles(Role.ADMIN)
  @Post('classes')
  createClass(@Body() dto: CreateClassDto) {
    return this.svc.createClass(dto);
  }
  @Get('classes')
  listClasses(@Query('academicYearId') academicYearId?: string) {
    return this.svc.listClasses(academicYearId);
  }
  @Roles(Role.ADMIN)
  @Patch('classes/:id')
  updateClass(@Param('id') id: string, @Body() dto: UpdateClassDto) {
    return this.svc.updateClass(id, dto);
  }
  @Roles(Role.ADMIN)
  @Delete('classes/:id')
  deleteClass(@Param('id') id: string) {
    return this.svc.deleteClass(id);
  }

  @Roles(Role.ADMIN)
  @Post('sections')
  createSection(@Body() dto: CreateSectionDto) {
    return this.svc.createSection(dto);
  }
  @Get('sections')
  listSections(@Query('classId') classId?: string) {
    return this.svc.listSections(classId);
  }
  @Get('sections/:id')
  getSection(@Param('id') id: string) {
    return this.svc.getSection(id);
  }
  @Roles(Role.ADMIN)
  @Patch('sections/:id')
  updateSection(@Param('id') id: string, @Body() dto: UpdateSectionDto) {
    return this.svc.updateSection(id, dto);
  }
  @Roles(Role.ADMIN)
  @Delete('sections/:id')
  deleteSection(@Param('id') id: string) {
    return this.svc.deleteSection(id);
  }

  // Subjects
  @Roles(Role.ADMIN)
  @Post('subjects')
  createSubject(@Body() dto: CreateSubjectDto) {
    return this.svc.createSubject(dto);
  }
  @Get('subjects')
  listSubjects() {
    return this.svc.listSubjects();
  }
  @Roles(Role.ADMIN)
  @Patch('subjects/:id')
  updateSubject(@Param('id') id: string, @Body() dto: UpdateSubjectDto) {
    return this.svc.updateSubject(id, dto);
  }
  @Roles(Role.ADMIN)
  @Delete('subjects/:id')
  deleteSubject(@Param('id') id: string) {
    return this.svc.deleteSubject(id);
  }

  // Courses
  @Roles(Role.ADMIN)
  @Post('courses')
  createCourse(@Body() dto: CreateCourseDto) {
    return this.svc.createCourse(dto);
  }

  @Get('courses')
  listCourses(
    @Query('sectionId') sectionId?: string,
    @Query('teacherId') teacherId?: string,
    @Query('academicYearId') academicYearId?: string,
    @Query('subjectId') subjectId?: string,
  ) {
    return this.svc.listCourses({
      sectionId,
      teacherId,
      academicYearId,
      subjectId,
    });
  }

  @Get('courses/:id')
  getCourse(@Param('id') id: string) {
    return this.svc.getCourse(id);
  }

  @Roles(Role.ADMIN)
  @Patch('courses/:id')
  updateCourse(@Param('id') id: string, @Body() dto: UpdateCourseDto) {
    return this.svc.updateCourse(id, dto);
  }
  @Roles(Role.ADMIN)
  @Delete('courses/:id')
  deleteCourse(@Param('id') id: string) {
    return this.svc.deleteCourse(id);
  }

  // Personalized: "me/courses"
  @Get('me/courses')
  myCourses(
    @CurrentUser() user: AuthUser,
    @Query('academicYearId') academicYearId?: string,
  ) {
    if (user.role === 'TEACHER') {
      return this.svc.coursesForTeacherUser(user.id);
    }
    if (user.role === 'STUDENT') {
      return this.svc.coursesForStudentUser(user.id, academicYearId);
    }
    return [];
  }

  // Enrollments
  @Roles(Role.ADMIN)
  @Post('enrollments')
  createEnrollment(@Body() dto: CreateEnrollmentDto) {
    return this.svc.createEnrollment(dto);
  }
  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('enrollments')
  listEnrollments(
    @Query('sectionId') sectionId?: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.svc.listEnrollments(sectionId, academicYearId);
  }
  @Roles(Role.ADMIN)
  @Patch('enrollments/:id')
  updateEnrollment(
    @Param('id') id: string,
    @Body() dto: UpdateEnrollmentDto,
  ) {
    return this.svc.updateEnrollment(id, dto);
  }
  @Roles(Role.ADMIN)
  @Delete('enrollments/:id')
  deleteEnrollment(@Param('id') id: string) {
    return this.svc.deleteEnrollment(id);
  }
}
