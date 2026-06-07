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
  CreateAdminDto,
  CreateParentDto,
  CreateStudentDto,
  CreateTeacherDto,
  ParentChildLinkDto,
} from './dto/create-user.dto';
import { CreateStudentWithParentsDto } from './dto/create-student-with-parents.dto';
import { AdminSetPasswordDto } from './dto/admin-set-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersDto } from './dto/list-users.dto';
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
  createAdmin(@Body() dto: CreateAdminDto) {
    return this.users.createAdmin(dto);
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
