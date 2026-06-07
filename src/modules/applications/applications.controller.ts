import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApplicationsService } from './applications.service';
import { CreateAdmissionApplicationDto } from './dto/create-admission-application.dto';
import { CreateTeacherApplicationDto } from './dto/create-teacher-application.dto';
import { ListAdmissionApplicationsDto } from './dto/list-admission-applications.dto';
import { ListTeacherApplicationsDto } from './dto/list-teacher-applications.dto';
import { UpdateAdmissionStatusDto } from './dto/update-admission-status.dto';
import { UpdateTeacherApplicationStatusDto } from './dto/update-teacher-status.dto';
import { TeacherCvPresignDto } from './dto/teacher-cv-presign.dto';

@ApiTags('applications')
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  /** Public — website /apply admission form */
  @Public()
  @Post('admissions')
  submitAdmission(@Body() dto: CreateAdmissionApplicationDto) {
    return this.applications.createAdmission(dto);
  }

  /** Public — presign CV upload (browser PUT to R2; requires bucket CORS). */
  @Public()
  @Post('teachers/cv-presign')
  presignTeacherCv(@Body() dto: TeacherCvPresignDto) {
    return this.applications.presignTeacherCv(dto);
  }

  /** Public — website /apply faculty form */
  @Public()
  @Post('teachers')
  submitTeacher(@Body() dto: CreateTeacherApplicationDto) {
    return this.applications.createTeacher(dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('teachers')
  listTeachers(@Query() q: ListTeacherApplicationsDto) {
    return this.applications.listTeachers(q);
  }

  /**
   * Suggested login username and employee code before approving (first free in DB).
   */
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('teachers/:id/provision-suggestions')
  teacherProvisionSuggestions(@Param('id') id: string) {
    return this.applications.suggestProvisionForTeacherApplication(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('teachers/:id/cv-download')
  downloadTeacherCv(@Param('id') id: string) {
    return this.applications.presignTeacherCvDownload(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch('teachers/:id')
  updateTeacherStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTeacherApplicationStatusDto,
  ) {
    return this.applications.updateTeacherStatus(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('admissions')
  listAdmissions(@Query() q: ListAdmissionApplicationsDto) {
    return this.applications.listAdmissions(q);
  }

  /**
   * Suggested login usernames from applicant names (first free in DB for each).
   * Edit in the approve dialog before submitting.
   */
  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('admissions/:id/username-suggestions')
  suggestUsernames(@Param('id') id: string) {
    return this.applications.suggestUsernamesForAdmission(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch('admissions/:id')
  updateAdmissionStatus(
    @Param('id') id: string,
    @Body() dto: UpdateAdmissionStatusDto,
  ) {
    return this.applications.updateAdmissionStatus(id, dto);
  }
}
