import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  CreateSalaryStructureDto,
  RecordSalaryPaymentDto,
} from './dto/salary.dto';

@Injectable()
export class SalariesService {
  constructor(private readonly prisma: PrismaService) {}

  createStructure(dto: CreateSalaryStructureDto) {
    return this.prisma.teacherSalaryStructure.create({
      data: {
        teacherId: dto.teacherId,
        baseSalary: dto.baseSalary,
        allowances: dto.allowances as any,
        deductions: dto.deductions as any,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
      },
    });
  }

  listStructuresForTeacher(teacherId: string) {
    return this.prisma.teacherSalaryStructure.findMany({
      where: { teacherId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  recordPayment(user: AuthUser, dto: RecordSalaryPaymentDto) {
    return this.prisma.salaryPayment.upsert({
      where: {
        teacherId_period: {
          teacherId: dto.teacherId,
          period: dto.period,
        },
      },
      update: {
        grossAmount: dto.grossAmount,
        netAmount: dto.netAmount,
        breakdown: dto.breakdown as any,
        paidAt: new Date(dto.paidAt),
        method: dto.method,
        reference: dto.reference,
        slipKey: dto.slipKey,
      },
      create: {
        teacherId: dto.teacherId,
        period: dto.period,
        grossAmount: dto.grossAmount,
        netAmount: dto.netAmount,
        breakdown: dto.breakdown as any,
        paidAt: new Date(dto.paidAt),
        method: dto.method,
        reference: dto.reference,
        slipKey: dto.slipKey,
        paidById: user.id,
      },
    });
  }

  listPaymentsForTeacher(teacherId: string) {
    return this.prisma.salaryPayment.findMany({
      where: { teacherId },
      orderBy: { paidAt: 'desc' },
    });
  }

  async paymentsForTeacherUser(teacherUserId: string) {
    const t = await this.prisma.teacherProfile.findUnique({
      where: { userId: teacherUserId },
    });
    if (!t) throw new NotFoundException();
    return this.listPaymentsForTeacher(t.id);
  }
}
