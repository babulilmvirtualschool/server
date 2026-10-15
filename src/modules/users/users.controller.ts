import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreateAdminDto,
  CreateParentDto,
  CreateStudentDto,
  CreateTeacherDto,
  ParentChildLinkDto,
} from './dto/create-user.dto';
import { CreateStudentWithParentsDto } from './dto/create-student-with-parents.dto';
import { AdminSetPasswordDto } from './dto/admin-set-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateStudentRecordDto } from './dto/update-student-record.dto';
import { DischargeStudentsDto, ListDischargedDto, ReadmitStudentDto, SetPhotoDto } from './dto/student-lifecycle.dto';
import { ExportStudentsDto, ListUsersDto } from './dto/list-users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Roles(Role.ADMIN)
  @Get()
  list(@Query() q: ListUsersDto) {
    return this.users.list(q);
  }

  /** Student: set/remove own photo. Declared before ':id' routes. */
  @Roles(Role.STUDENT)
  @Patch('me/photo')
  setOwnPhoto(@CurrentUser() user: AuthUser, @Body() dto: SetPhotoDto) {
    return this.users.setPhoto(user.id, dto.avatarKey, user.id);
  }

  /** Discharged students (left the school), newest first. */
  @Roles(Role.ADMIN)
  @Get('students/discharged')
  listDischarged(@Query() q: ListDischargedDto) {
    return this.users.listDischarged(q);
  }

  /** Discharge students: leaving date + reason; logins blocked automatically. */
  @Roles(Role.ADMIN)
  @Post('students/discharge')
  dischargeStudents(@Body() dto: DischargeStudentsDto, @CurrentUser() user: AuthUser) {
    return this.users.dischargeStudents(dto, user.id);
  }

  @Roles(Role.ADMIN)
  @Post('students/:id/readmit')
  readmitStudent(@Param('id') id: string, @Body() dto: ReadmitStudentDto) {
    return this.users.readmitStudent(id, dto);
  }

  /** Discharge records = leaving certificates. */
  @Roles(Role.ADMIN)
  @Get('students/:id/discharges')
  studentDischarges(@Param('id') id: string) {
    return this.users.studentDischarges(id);
  }

  /** Admin: username/email + the issued password while the user hasn't changed it. */
  @Roles(Role.ADMIN)
  @Get(':id/login')
  loginDetails(@Param('id') id: string) {
    return this.users.getLoginDetails(id);
  }

  /** Admin: set/remove anyone's photo. */
  @Roles(Role.ADMIN)
  @Patch(':id/photo')
  setPhoto(@Param('id') id: string, @Body() dto: SetPhotoDto, @CurrentUser() user: AuthUser) {
    return this.users.setPhoto(id, dto.avatarKey, user.id);
  }

  /** Edit student: the full record (student, admission details, parents, class/section). */
  @Roles(Role.ADMIN)
  @Put('students/:id/record')
  updateStudentRecord(@Param('id') id: string, @Body() dto: UpdateStudentRecordDto) {
    return this.users.updateStudentRecord(id, dto);
  }

  /** Main admin only: counts per school and combined. */
  @Roles(Role.ADMIN)
  @Get('campus-totals')
  campusTotals(@CurrentUser() user: AuthUser) {
    if (!user.allCampuses) throw new ForbiddenException('Only a main admin can see both schools.');
    return this.users.campusTotals();
  }

  @Roles(Role.ADMIN)
  @Get('students/export')
  exportStudents(@Query() query: ExportStudentsDto) {
    return this.users.exportStudents(query);
  }

  @Roles(Role.ADMIN)
  @Get('teachers/create-suggestions')
  suggestManualTeacherCreate(
    @Query('firstName') firstName: string,
    @Query('lastName') lastName: string,
  ) {
    return this.users.suggestManualTeacherCreate(firstName ?? '', lastName ?? '');
  }

  @Roles(Role.ADMIN)
  @Get(':id/delete-impact')
  deleteImpact(@Param('id') id: string) {
    return this.users.getDeleteImpact(id);
  }

  @Roles(Role.ADMIN)
  @Get(':id')
  one(@Param('id') id: string) {
    return this.users.findById(id);
  }

  @Roles(Role.ADMIN)
  @Post('admins')
  createAdmin(@Body() dto: CreateAdminDto, @CurrentUser() user: AuthUser) {
    return this.users.createAdmin(dto, user.allCampuses);
  }

  @Roles(Role.ADMIN)
  @Post('teachers')
  createTeacher(@Body() dto: CreateTeacherDto) {
    return this.users.createTeacher(dto);
  }

  @Roles(Role.ADMIN)
  @Post('students/with-parents')
  createStudentWithParents(@Body() dto: CreateStudentWithParentsDto) {
    return this.users.createStudentWithParents(dto);
  }

  @Roles(Role.ADMIN)
  @Post('students')
  createStudent(@Body() dto: CreateStudentDto) {
    return this.users.createStudent(dto);
  }

  @Roles(Role.ADMIN)
  @Post('parents')
  createParent(@Body() dto: CreateParentDto) {
    return this.users.createParent(dto);
  }

  @Roles(Role.ADMIN)
  @Post('parents/:userId/children')
  linkChild(
    @Param('userId') parentUserId: string,
    @Body() dto: ParentChildLinkDto,
  ) {
    return this.users.linkChildToParent(parentUserId, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('parents/:userId/children/:linkId')
  unlinkChild(
    @Param('userId') parentUserId: string,
    @Param('linkId') linkId: string,
  ) {
    return this.users.unlinkChildFromParent(parentUserId, linkId);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/password')
  adminSetPassword(
    @Param('id') id: string,
    @Body() dto: AdminSetPasswordDto,
  ) {
    return this.users.adminSetPassword(id, dto.password);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.users.remove(id);
  }

  @Roles(Role.ADMIN)
  @Post(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.users.deactivate(id);
  }

  @Roles(Role.ADMIN)
  @Post(':id/activate')
  activate(@Param('id') id: string) {
    return this.users.activate(id);
  }
}
