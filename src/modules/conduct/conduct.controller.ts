import { Body, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ConductService } from './conduct.service';
import { ConductSheetQueryDto, ListConductDto, SaveConductSheetDto } from './dto/conduct.dto';

/** PDF2 Admin 1 Character & Conduct Assessment (weekly / 15-day / monthly). */
@ApiTags('conduct')
@ApiBearerAuth()
@Controller()
export class ConductController {
  constructor(private readonly svc: ConductService) {}

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('conduct-sheet/classes')
  classes(@CurrentUser() user: AuthUser) {
    return this.svc.classes(user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('conduct-sheet')
  sheet(@Query() q: ConductSheetQueryDto, @CurrentUser() user: AuthUser) {
    return this.svc.sheet(q, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Put('conduct-sheet')
  save(@Body() dto: SaveConductSheetDto, @CurrentUser() user: AuthUser) {
    return this.svc.saveSheet(dto, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Get('conduct-assessments')
  list(@Query() q: ListConductDto, @CurrentUser() user: AuthUser) {
    return this.svc.list(q, user);
  }

  @Roles(Role.ADMIN, Role.TEACHER)
  @Delete('conduct-assessments/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.remove(id, user);
  }

  @Roles(Role.STUDENT)
  @Get('me/conduct')
  mine(@CurrentUser() user: AuthUser) {
    return this.svc.mine(user);
  }

  @Roles(Role.PARENT)
  @Get('children/:studentId/conduct')
  child(@Param('studentId') studentId: string, @CurrentUser() user: AuthUser) {
    return this.svc.child(user, studentId);
  }
}
