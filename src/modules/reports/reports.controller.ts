import { Controller, Get, Param, ParseIntPipe, DefaultValuePipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Growth report of one student (StudentProfile id): attendance per month, exam results per term, assignment and quiz averages. */
  @Get('student-growth/:studentId')
  studentGrowth(
    @Param('studentId') studentId: string,
    @Query('months', new DefaultValuePipe(6), ParseIntPipe) months: number,
  ) {
    return this.reports.studentGrowth(studentId, Math.min(Math.max(months, 1), 12));
  }
}
