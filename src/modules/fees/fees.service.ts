import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  CreateFeeStructureDto,
  GenerateInvoicesDto,
  RecordFeePaymentDto,
} from './dto/fees.dto';

@Injectable()
export class FeesService {
  constructor(private readonly prisma: PrismaService) {}

  createStructure(dto: CreateFeeStructureDto) {
    return this.prisma.feeStructure.create({
      data: {
        classId: dto.classId,
        academicYearId: dto.academicYearId,
        name: dto.name,
        components: {
          createMany: {
            data: dto.components.map((c) => ({
              name: c.name,
              amount: c.amount,
              frequency: c.frequency,
              isOptional: c.isOptional ?? false,
            })),
          },
        },
      },
      include: { components: true },
    });
  }

  listStructures(classId?: string, academicYearId?: string) {
    return this.prisma.feeStructure.findMany({
      where: {
        ...(classId ? { classId } : {}),
        ...(academicYearId ? { academicYearId } : {}),
      },
      include: { components: true, class: true, academicYear: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  deleteStructure(id: string) {
    return this.prisma.feeStructure.delete({ where: { id } });
  }

  /**
   * Generate an invoice for every student currently enrolled in any section of
   * the given fee structure's class+year.
   */
  async generateInvoices(dto: GenerateInvoicesDto) {
    const structure = await this.prisma.feeStructure.findUnique({
      where: { id: dto.feeStructureId },
      include: { components: true },
    });
    if (!structure) throw new NotFoundException('Fee structure not found');

    const components = structure.components.filter((c) =>
      dto.includeFrequencies.includes(c.frequency),
    );
    if (components.length === 0) {
      throw new BadRequestException('No components match the chosen frequencies');
    }
    const total = components.reduce((s, c) => s + c.amount, 0);
    const lineItems = components.map((c) => ({
      name: c.name,
      amount: c.amount,
      frequency: c.frequency,
      isOptional: c.isOptional,
    }));

    const enrollments = await this.prisma.studentEnrollment.findMany({
      where: {
        academicYearId: structure.academicYearId,
        section: { classId: structure.classId },
        status: 'ACTIVE',
      },
      select: { studentId: true },
    });

    const dueDate = new Date(dto.dueDate);
    const created = await this.prisma.$transaction(
      enrollments.map((e) =>
        this.prisma.feeInvoice.upsert({
          where: {
            studentId_period: {
              studentId: e.studentId,
              period: dto.period,
            },
          },
          update: {},
          create: {
            studentId: e.studentId,
            period: dto.period,
            dueDate,
            totalAmount: total,
            lineItems: lineItems as any,
          },
        }),
      ),
    );
    return { count: created.length, generated: created };
  }

  listInvoices(status?: InvoiceStatus, studentId?: string, period?: string) {
    return this.prisma.feeInvoice.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(studentId ? { studentId } : {}),
        ...(period ? { period } : {}),
      },
      include: {
        student: { include: { user: true } },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async invoicesForStudentUser(studentUserId: string) {
    const s = await this.prisma.studentProfile.findUnique({
      where: { userId: studentUserId },
    });
    if (!s) throw new NotFoundException();
    return this.prisma.feeInvoice.findMany({
      where: { studentId: s.id },
      include: { payments: true },
      orderBy: { dueDate: 'desc' },
    });
  }

  async invoicesForParentUser(parentUserId: string) {
    const p = await this.prisma.parentProfile.findUnique({
      where: { userId: parentUserId },
      include: { children: true },
    });
    if (!p) throw new NotFoundException();
    const studentIds = p.children.map((c) => c.studentId);
    return this.prisma.feeInvoice.findMany({
      where: { studentId: { in: studentIds } },
      include: { payments: true, student: { include: { user: true } } },
      orderBy: { dueDate: 'desc' },
    });
  }

  async recordPayment(
    invoiceId: string,
    user: AuthUser,
    dto: RecordFeePaymentDto,
  ) {
    if (user.role !== Role.ADMIN) throw new ForbiddenException();
    const inv = await this.prisma.feeInvoice.findUnique({
      where: { id: invoiceId },
    });
    if (!inv) throw new NotFoundException();

    return this.prisma.$transaction(async (tx) => {
      await tx.feePayment.create({
        data: {
          invoiceId,
          amount: dto.amount,
          paidAt: new Date(dto.paidAt),
          method: dto.method,
          reference: dto.reference,
          receiptKey: dto.receiptKey,
          recordedById: user.id,
        },
      });
      const paidAgg = await tx.feePayment.aggregate({
        where: { invoiceId },
        _sum: { amount: true },
      });
      const paid = paidAgg._sum.amount ?? 0;
      const status: InvoiceStatus =
        paid >= inv.totalAmount
          ? InvoiceStatus.PAID
          : paid > 0
            ? InvoiceStatus.PARTIAL
            : InvoiceStatus.PENDING;
      return tx.feeInvoice.update({
        where: { id: invoiceId },
        data: { amountPaid: paid, status },
        include: { payments: true },
      });
    });
  }

  cancelInvoice(invoiceId: string) {
    return this.prisma.feeInvoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.CANCELLED },
    });
  }
}
