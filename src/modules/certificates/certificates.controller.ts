import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CertificatesService } from './certificates.service';
import { CreateCertificateDto, IdCardsQueryDto, ListCertificatesDto, PrefillCertificateDto, UpdateCertificateDto } from './dto/certificates.dto';

/** PDF2 Admin 2 certificates, Student 6 / Teacher 11 certificates download, Teacher 13 / Student 10 ID cards. */
@ApiTags('certificates')
@ApiBearerAuth()
@Controller()
export class CertificatesController {
  constructor(private readonly svc: CertificatesService) {}

  @Roles(Role.ADMIN)
  @Get('certificates')
  list(@Query() q: ListCertificatesDto) {
    return this.svc.list(q);
  }

  @Roles(Role.ADMIN)
  @Get('certificates/prefill')
  prefill(@Query() q: PrefillCertificateDto) {
    return this.svc.prefill(q);
  }

  @Roles(Role.ADMIN)
  @Post('certificates')
  create(@Body() dto: CreateCertificateDto, @CurrentUser() user: AuthUser) {
    return this.svc.create(dto, user);
  }

  @Roles(Role.ADMIN)
  @Patch('certificates/:id')
  update(@Param('id') id: string, @Body() dto: UpdateCertificateDto) {
    return this.svc.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('certificates/:id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Roles(Role.TEACHER)
  @Get('certificates/my-students')
  forTeacher(@Query() q: ListCertificatesDto, @CurrentUser() user: AuthUser) {
    return this.svc.forTeacher(user, q);
  }

  @Roles(Role.STUDENT, Role.TEACHER, Role.STAFF)
  @Get('me/issued-certificates')
  mine(@CurrentUser() user: AuthUser) {
    return this.svc.mine(user);
  }

  @Roles(Role.PARENT)
  @Get('children/:studentId/certificates')
  child(@Param('studentId') studentId: string, @CurrentUser() user: AuthUser) {
    return this.svc.forChild(user, studentId);
  }

  @Roles(Role.ADMIN)
  @Get('id-cards')
  idCards(@Query() q: IdCardsQueryDto) {
    return this.svc.idCards(q);
  }

  @Roles(Role.STUDENT, Role.TEACHER, Role.STAFF)
  @Get('me/id-card')
  myCard(@CurrentUser() user: AuthUser) {
    return this.svc.myCard(user);
  }
}
