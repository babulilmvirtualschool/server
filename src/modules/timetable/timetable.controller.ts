import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreateTimetableSlotDto,
  UpdateTimetableSlotDto,
} from './dto/timetable-slot.dto';
import { TimetableService } from './timetable.service';

@ApiTags('timetable')
@ApiBearerAuth()
@Controller()
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @Roles(Role.ADMIN)
  @Post('timetable-slots')
  create(@Body() dto: CreateTimetableSlotDto) {
    return this.timetable.create(dto);
  }

  @Roles(Role.ADMIN)
  @Patch('timetable-slots/:id')
  update(@Param('id') id: string, @Body() dto: UpdateTimetableSlotDto) {
    return this.timetable.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('timetable-slots/:id')
  remove(@Param('id') id: string) {
    return this.timetable.remove(id);
  }

  @Get('sections/:sectionId/timetable')
  forSection(@Param('sectionId') sectionId: string) {
    return this.timetable.forSection(sectionId);
  }

  @Roles(Role.TEACHER, Role.STUDENT)
  @Get('me/timetable')
  myTimetable(@CurrentUser() user: AuthUser) {
    return this.timetable.forMe(user);
  }
}
