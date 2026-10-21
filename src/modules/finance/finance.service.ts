import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Campus,
  DiscountValueType,
  FeeFrequency,
  InvoiceStatus,
  Prisma,
} from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { currentCampus } from '../../common/campus/campus-context';
import { getSkipTake, paginate } from '../../common/pagination/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ChallansQueryDto,
  CollectFeeDto,
  CreateFeeDiscountDto,
  FamiliesQueryDto,
  FamilyChallanDto,
  FeeDiscountsQueryDto,
  FeeTypesQueryDto,
  GenerateChallansDto,
  MissingVouchersQueryDto,
  SaveFeeSettingsDto,
  SaveFeeTypeDto,
  SaveSiblingRulesDto,
  UpdateFeeDiscountDto,
} from './dto/finance.dto';

const DEFAULT_SETTINGS = {
  currencySymbol: 'Rs.',
  sessionStartMonth: 4,
  dueDay: 10,
  lateFeeEnabled: false,
  lateFeeAmount: 0,
  printInstructions: true,
  instructions: null as string | null,
  hideDiscount: false,
  blockDefaulters: false,
  defaulterGraceDays: 30,
  voucherCopies: 3,
  siblingPolicyEnabled: false,
  siblingMonthlyOnly: true,
};
type FeeSettingsView = typeof DEFAULT_SETTINGS & { saved: boolean };

/** A line of a challan (snapshot stored in FeeInvoice.lineItems). */
export type ChallanLine = {
  feeTypeId: string;
  name: string;
  frequency: FeeFrequency;
  amount: number;
  discount: number;
  discountIds: string[];
  siblingDiscount: number;
  net: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const name = (u?: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}`.trim() : '');
const valueOff = (base: number, valueType: DiscountValueType, value: number) =>
  round2(Math.min(base, valueType === DiscountValueType.PERCENT ? (base * value) / 100 : value));
const OPEN: InvoiceStatus[] = [InvoiceStatus.PENDING, InvoiceStatus.PARTIAL, InvoiceStatus.OVERDUE];
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  PENDING: 'UNPAID',
  OVERDUE: 'UNPAID',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
};

/**
 * Finance (Day 6): fee settings, fee types, student discounts, sibling policy, fee calculation, challans (single / class / all /
 * family), challan list, collection (paid oldest first, late fee after the due date) and fee slips.
 */
@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  private prefix() {
    return (currentCampus() ?? Campus.ONLINE) === Campus.PHYSICAL ? 'PH' : 'ON';
  }

  // ---------- settings ----------
  async getSettings(): Promise<FeeSettingsView> {
    const s = await this.prisma.feeSettings.findFirst();
    if (!s) return { ...DEFAULT_SETTINGS, saved: false };
    const { id: _id, campus: _c, updatedAt: _u, ...rest } = s;
    return { ...rest, saved: true };
  }

  async saveSettings(dto: SaveFeeSettingsDto) {
    const data = { ...dto, instructions: dto.instructions?.trim() || null };
    const existing = await this.prisma.feeSettings.findFirst({ select: { id: true } });
    if (existing) await this.prisma.feeSettings.update({ where: { id: existing.id }, data });
    else await this.prisma.feeSettings.create({ data });
    return this.getSettings();
  }

  // ---------- fee types ----------
  private async yearId(academicYearId?: string) {
    if (academicYearId) return academicYearId;
    const cur = await this.prisma.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
    return cur?.id ?? null;
  }

  async listFeeTypes(q: FeeTypesQueryDto) {
    const yearId = await this.yearId(q.academicYearId);
    const rows = await this.prisma.feeType.findMany({
      where: { ...(q.classId ? { classId: q.classId } : {}), ...(yearId ? { class: { academicYearId: yearId } } : {}) },
      include: { class: { select: { id: true, name: true, level: true } }, _count: { select: { discounts: true } } },
    });
    return rows.sort((a, b) => a.class.level - b.class.level || a.class.name.localeCompare(b.class.name) || a.name.localeCompare(b.name));
  }

  async createFeeType(dto: SaveFeeTypeDto) {
    const cls = await this.prisma.class.findUnique({ where: { id: dto.classId }, select: { id: true } });
    if (!cls) throw new BadRequestException({ message: 'Class not found', fields: { classId: 'Choose a class' } });
    const dup = await this.prisma.feeType.findFirst({ where: { classId: dto.classId, name: { equals: dto.name.trim(), mode: 'insensitive' } } });
    if (dup) throw new ConflictException({ message: 'This class already has a fee type with this name.', fields: { name: 'Already exists' } });
    return this.prisma.feeType.create({
      data: { classId: dto.classId, name: dto.name.trim(), frequency: dto.frequency, amount: round2(dto.amount), isActive: dto.isActive ?? true },
      include: { class: { select: { id: true, name: true, level: true } } },
    });
  }

  async updateFeeType(id: string, dto: SaveFeeTypeDto) {
    const t = await this.prisma.feeType.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Fee type not found');
    const dup = await this.prisma.feeType.findFirst({
      where: { id: { not: id }, classId: dto.classId, name: { equals: dto.name.trim(), mode: 'insensitive' } },
    });
    if (dup) throw new ConflictException({ message: 'This class already has a fee type with this name.', fields: { name: 'Already exists' } });
    return this.prisma.feeType.update({
      where: { id },
      data: { classId: dto.classId, name: dto.name.trim(), frequency: dto.frequency, amount: round2(dto.amount), isActive: dto.isActive ?? t.isActive },
      include: { class: { select: { id: true, name: true, level: true } } },
    });
  }

  /** Challans already made keep their own copy of the fee lines. */
  async deleteFeeType(id: string) {
    const t = await this.prisma.feeType.findUnique({ where: { id }, select: { id: true } });
    if (!t) throw new NotFoundException('Fee type not found');
    await this.prisma.feeType.delete({ where: { id } });
    return { success: true as const };
  }

  // ---------- discounts ----------
  private discountInclude = {
    feeType: { select: { id: true, name: true, frequency: true, amount: true, class: { select: { name: true } } } },
    student: {
      select: {
        id: true,
        admissionNo: true,
        user: { select: { firstName: true, lastName: true } },
        enrollments: {
          where: { status: 'ACTIVE' as const, academicYear: { isCurrent: true } },
          take: 1,
          select: { rollNumber: true, section: { select: { name: true, class: { select: { id: true, name: true } } } } },
        },
      },
    },
  };

  private discountView(d: Prisma.FeeDiscountGetPayload<{ include: FinanceService['discountInclude'] }>) {
    const e = d.student.enrollments[0];
    return {
      id: d.id,
      frequency: d.frequency,
      valueType: d.valueType,
      value: d.value,
      amountOff: valueOff(d.feeType.amount, d.valueType, d.value),
      isActive: d.isActive,
      note: d.note,
      appliedCount: d.appliedCount,
      lastAppliedPeriod: d.lastAppliedPeriod,
      feeType: { id: d.feeType.id, name: d.feeType.name, amount: d.feeType.amount, className: d.feeType.class.name },
      student: {
        id: d.student.id,
        name: name(d.student.user),
        admissionNo: d.student.admissionNo,
        classLabel: e ? `${e.section.class.name} · ${e.section.name}` : null,
        rollNumber: e?.rollNumber ?? null,
      },
    };
  }

  async listDiscounts(q: FeeDiscountsQueryDto) {
    const s = q.search?.trim();
    const rows = await this.prisma.feeDiscount.findMany({
      where: {
        ...(q.classId ? { feeType: { classId: q.classId } } : {}),
        ...(s
          ? {
              student: {
                OR: [
                  { admissionNo: { contains: s, mode: 'insensitive' } },
                  { user: { firstName: { contains: s, mode: 'insensitive' } } },
                  { user: { lastName: { contains: s, mode: 'insensitive' } } },
                ],
              },
            }
          : {}),
      },
      include: this.discountInclude,
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    return rows.map((d) => this.discountView(d));
  }

  async createDiscounts(dto: CreateFeeDiscountDto) {
    const type = await this.prisma.feeType.findUnique({ where: { id: dto.feeTypeId } });
    if (!type) throw new BadRequestException({ message: 'Fee type not found', fields: { feeTypeId: 'Choose a fee type' } });
    if (dto.valueType === DiscountValueType.PERCENT && dto.value > 100) {
      throw new BadRequestException({ message: 'A percentage discount can be at most 100 %.', fields: { value: 'At most 100' } });
    }
    const ids = [...new Set(dto.studentIds)];
    const students = await this.prisma.studentProfile.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (students.length !== ids.length) throw new BadRequestException('One or more students were not found.');
    const created = await this.prisma.$transaction(
      ids.map((studentId) =>
        this.prisma.feeDiscount.create({
          data: { studentId, feeTypeId: type.id, frequency: dto.frequency, valueType: dto.valueType, value: dto.value, note: dto.note?.trim() || null },
          include: this.discountInclude,
        }),
      ),
    );
    return created.map((d) => this.discountView(d));
  }

  async updateDiscount(id: string, dto: UpdateFeeDiscountDto) {
    const d = await this.prisma.feeDiscount.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Discount not found');
    if ((dto.valueType ?? d.valueType) === DiscountValueType.PERCENT && (dto.value ?? d.value) > 100) {
      throw new BadRequestException({ message: 'A percentage discount can be at most 100 %.', fields: { value: 'At most 100' } });
    }
    const updated = await this.prisma.feeDiscount.update({
      where: { id },
      data: { ...dto, ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}) },
      include: this.discountInclude,
    });
    return this.discountView(updated);
  }

  async deleteDiscount(id: string) {
    const d = await this.prisma.feeDiscount.findUnique({ where: { id }, select: { id: true } });
    if (!d) throw new NotFoundException('Discount not found');
    await this.prisma.feeDiscount.delete({ where: { id } });
    return { success: true as const };
  }

  // ---------- sibling policy + families ----------
  listSiblingRules() {
    return this.prisma.siblingDiscountRule.findMany({ orderBy: { childNumber: 'asc' } });
  }

  async saveSiblingRules(dto: SaveSiblingRulesDto) {
    const nums = dto.rules.map((r) => r.childNumber);
    if (new Set(nums).size !== nums.length) throw new BadRequestException('Each child number can only have one rule.');
    if (dto.rules.some((r) => r.valueType === DiscountValueType.PERCENT && r.value > 100)) {
      throw new BadRequestException('A percentage discount can be at most 100 %.');
    }
    await this.prisma.$transaction([
      this.prisma.siblingDiscountRule.deleteMany({}),
      ...dto.rules.map((r) => this.prisma.siblingDiscountRule.create({ data: { childNumber: r.childNumber, valueType: r.valueType, value: r.value } })),
    ]);
    return this.listSiblingRules();
  }

  /**
   * Families of the current year's active students: children who share a parent are one family; the eldest (date of birth,
   * then admission no.) is child 1. Used by the sibling policy and the family voucher.
   */
  private async families() {
    const enrolled = await this.prisma.studentEnrollment.findMany({
      where: { status: 'ACTIVE', academicYear: { isCurrent: true }, student: { dischargedAt: null } },
      select: {
        rollNumber: true,
        section: { select: { id: true, name: true, class: { select: { name: true } } } },
        student: {
          select: {
            id: true,
            admissionNo: true,
            user: { select: { firstName: true, lastName: true, dateOfBirth: true } },
            parents: {
              select: {
                relation: true,
                parentId: true,
                parent: { select: { user: { select: { firstName: true, lastName: true, phone: true } } } },
              },
            },
          },
        },
      },
    });
    // Union students who share any parent.
    const parentOf = new Map<string, string>();
    const find = (x: string): string => (parentOf.get(x) === x || !parentOf.has(x) ? x : find(parentOf.get(x)!));
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parentOf.set(rb, ra);
    };
    const byParent = new Map<string, string>();
    for (const e of enrolled) {
      parentOf.set(e.student.id, parentOf.get(e.student.id) ?? e.student.id);
      for (const p of e.student.parents) {
        const other = byParent.get(p.parentId);
        if (other) union(other, e.student.id);
        else byParent.set(p.parentId, e.student.id);
      }
    }
    const groups = new Map<string, typeof enrolled>();
    for (const e of enrolled) {
      const root = find(e.student.id);
      groups.set(root, [...(groups.get(root) ?? []), e]);
    }
    return [...groups.values()].map((kids) => {
      const sorted = kids.slice().sort((a, b) => {
        const da = a.student.user.dateOfBirth?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const db = b.student.user.dateOfBirth?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return da - db || a.student.admissionNo.localeCompare(b.student.admissionNo);
      });
      const fatherLink = sorted.flatMap((k) => k.student.parents).find((p) => p.relation === 'FATHER');
      const anyParent = fatherLink ?? sorted.flatMap((k) => k.student.parents)[0];
      return {
        familyId: find(sorted[0].student.id),
        father: anyParent ? { name: name(anyParent.parent.user), phone: anyParent.parent.user.phone } : null,
        children: sorted.map((k, i) => ({
          studentId: k.student.id,
          name: name(k.student.user),
          admissionNo: k.student.admissionNo,
          classLabel: `${k.section.class.name} · ${k.section.name}`,
          rollNumber: k.rollNumber,
          position: i + 1,
        })),
      };
    });
  }

  private static ruleFor(rules: { childNumber: number; valueType: DiscountValueType; value: number }[], position: number) {
    return rules.filter((r) => r.childNumber <= position).sort((a, b) => b.childNumber - a.childNumber)[0] ?? null;
  }

  /** PDF1 6.2 Sibling group: families with 2+ children, their order and the sibling concession each child gets. */
  async listFamilies(q: FamiliesQueryDto) {
    const [families, rules, settings] = await Promise.all([this.families(), this.listSiblingRules(), this.getSettings()]);
    const s = q.search?.trim().toLowerCase();
    return families
      .filter((f) => f.children.length > 1)
      .filter(
        (f) =>
          !s ||
          f.father?.name.toLowerCase().includes(s) ||
          (f.father?.phone ?? '').includes(s) ||
          f.children.some((c) => c.name.toLowerCase().includes(s) || c.admissionNo.toLowerCase().includes(s)),
      )
      .map((f) => ({
        ...f,
        children: f.children.map((c) => {
          const r = settings.siblingPolicyEnabled ? FinanceService.ruleFor(rules, c.position) : null;
          return { ...c, siblingRule: r ? { childNumber: r.childNumber, valueType: r.valueType, value: r.value } : null };
        }),
      }))
      .sort((a, b) => (a.father?.name ?? '').localeCompare(b.father?.name ?? ''));
  }

  // ---------- fee calculation ----------
  private static sessionYear(period: string, startMonth: number) {
    const [y, m] = period.split('-').map(Number);
    return m >= startMonth ? y : y - 1;
  }

  private dueDateOf(period: string, dueDay: number) {
    const [y, m] = period.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return new Date(Date.UTC(y, m - 1, Math.min(dueDay, last)));
  }

  /** Lines, discounts, sibling concession and arrears for one student and month (nothing saved). */
  async calculate(studentId: string, period: string, feeTypeIds?: string[] | null) {
    const settings = await this.getSettings();
    const student = await this.prisma.studentProfile.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        admissionNo: true,
        dischargedAt: true,
        user: { select: { firstName: true, lastName: true } },
        enrollments: {
          where: { status: 'ACTIVE', academicYear: { isCurrent: true } },
          take: 1,
          select: { rollNumber: true, section: { select: { id: true, name: true, class: { select: { id: true, name: true } } } } },
        },
      },
    });
    if (!student) throw new NotFoundException('Student not found');
    const enr = student.enrollments[0];
    if (!enr) throw new BadRequestException(`${name(student.user)} is not enrolled in a class this year.`);
    const types = await this.prisma.feeType.findMany({ where: { classId: enr.section.class.id, isActive: true }, orderBy: { name: 'asc' } });
    const month = Number(period.slice(5, 7));
    const chosen = feeTypeIds?.length
      ? types.filter((t) => feeTypeIds.includes(t.id))
      : types.filter((t) => t.frequency === FeeFrequency.MONTHLY || (t.frequency === FeeFrequency.ANNUAL && month === settings.sessionStartMonth));
    const discounts = await this.prisma.feeDiscount.findMany({
      where: { studentId, isActive: true, feeTypeId: { in: chosen.map((t) => t.id) } },
    });
    const sy = FinanceService.sessionYear(period, settings.sessionStartMonth);
    // Sibling position in the family (eldest = 1).
    let siblingRule: { childNumber: number; valueType: DiscountValueType; value: number } | null = null;
    let position = 1;
    if (settings.siblingPolicyEnabled) {
      const fam = (await this.families()).find((f) => f.children.some((c) => c.studentId === studentId));
      position = fam?.children.find((c) => c.studentId === studentId)?.position ?? 1;
      siblingRule = FinanceService.ruleFor(await this.listSiblingRules(), position);
    }
    const lines: ChallanLine[] = chosen.map((t) => {
      const eligible = discounts.filter(
        (d) =>
          d.feeTypeId === t.id &&
          (d.frequency === FeeFrequency.MONTHLY ||
            (d.frequency === FeeFrequency.ANNUAL &&
              (!d.lastAppliedPeriod ||
                d.lastAppliedPeriod === period ||
                FinanceService.sessionYear(d.lastAppliedPeriod, settings.sessionStartMonth) !== sy)) ||
            (d.frequency === FeeFrequency.ONE_TIME && (d.appliedCount === 0 || d.lastAppliedPeriod === period))),
      );
      const discount = round2(Math.min(t.amount, eligible.reduce((n, d) => n + valueOff(t.amount, d.valueType, d.value), 0)));
      const afterDiscount = round2(t.amount - discount);
      const siblingDiscount =
        siblingRule && (!settings.siblingMonthlyOnly || t.frequency === FeeFrequency.MONTHLY)
          ? valueOff(afterDiscount, siblingRule.valueType, siblingRule.value)
          : 0;
      return {
        feeTypeId: t.id,
        name: t.name,
        frequency: t.frequency,
        amount: t.amount,
        discount,
        discountIds: eligible.map((d) => d.id),
        siblingDiscount,
        net: round2(afterDiscount - siblingDiscount),
      };
    });
    const total = round2(lines.reduce((n, l) => n + l.net, 0));
    const discountTotal = round2(lines.reduce((n, l) => n + l.discount + l.siblingDiscount, 0));
    const open = await this.prisma.feeInvoice.findMany({
      where: { studentId, status: { in: OPEN }, period: { not: period } },
      select: { totalAmount: true, lateFee: true, amountPaid: true },
    });
    const prevBalance = round2(open.reduce((n, i) => n + i.totalAmount + i.lateFee - i.amountPaid, 0));
    return {
      student: { id: student.id, name: name(student.user), admissionNo: student.admissionNo, discharged: !!student.dischargedAt },
      sectionId: enr.section.id,
      classLabel: `${enr.section.class.name} · ${enr.section.name}`,
      rollNumber: enr.rollNumber,
      period,
      dueDate: this.dueDateOf(period, settings.dueDay).toISOString().slice(0, 10),
      availableFeeTypes: types.map((t) => ({ id: t.id, name: t.name, frequency: t.frequency, amount: t.amount, included: chosen.some((c) => c.id === t.id) })),
      siblingPosition: position,
      siblingRule,
      lines,
      total,
      discountTotal,
      prevBalance,
      payable: round2(total + prevBalance),
    };
  }

  // ---------- challans ----------
  private async nextNumber(kind: 'V' | 'FV' | 'R', count = 1): Promise<string[]> {
    const prefix = `${this.prefix()}-${kind}-`;
    let last: string | null = null;
    if (kind === 'R') {
      last = (await this.prisma.feePayment.findFirst({ where: { slipNo: { startsWith: prefix } }, orderBy: { slipNo: 'desc' }, select: { slipNo: true } }))?.slipNo ?? null;
    } else if (kind === 'FV') {
      last =
        (await this.prisma.feeInvoice.findFirst({ where: { familyVoucherNo: { startsWith: prefix } }, orderBy: { familyVoucherNo: 'desc' }, select: { familyVoucherNo: true } }))
          ?.familyVoucherNo ?? null;
    } else {
      last = (await this.prisma.feeInvoice.findFirst({ where: { voucherNo: { startsWith: prefix } }, orderBy: { voucherNo: 'desc' }, select: { voucherNo: true } }))?.voucherNo ?? null;
    }
    const n = last ? parseInt(last.slice(prefix.length), 10) || 0 : 0;
    return Array.from({ length: count }, (_, i) => `${prefix}${String(n + i + 1).padStart(6, '0')}`);
  }

  /** Discount usage for Yearly / One-time discounts (so they apply once a session / once). */
  private async markDiscountsUsed(tx: Prisma.TransactionClient, lines: ChallanLine[], period: string, undo = false) {
    for (const id of [...new Set(lines.flatMap((l) => l.discountIds))]) {
      const d = await tx.feeDiscount.findUnique({ where: { id } });
      if (!d) continue;
      if (undo) {
        await tx.feeDiscount.update({
          where: { id },
          data: { appliedCount: Math.max(0, d.appliedCount - 1), ...(d.lastAppliedPeriod === period ? { lastAppliedPeriod: null } : {}) },
        });
      } else {
        await tx.feeDiscount.update({ where: { id }, data: { appliedCount: d.appliedCount + 1, lastAppliedPeriod: period } });
      }
    }
  }

  /** Creates one student's challan for the month, or returns the existing one (`created: false`). */
  private async createChallan(studentId: string, period: string, feeTypeIds: string[] | null, dueDate?: string) {
    const existing = await this.prisma.feeInvoice.findUnique({ where: { studentId_period: { studentId, period } } });
    if (existing) return { invoice: existing, created: false, reason: 'already has a challan for this month' };
    const calc = await this.calculate(studentId, period, feeTypeIds);
    if (calc.student.discharged) return { invoice: null, created: false, reason: 'has left the school' };
    if (!calc.lines.length) return { invoice: null, created: false, reason: 'no fee types for this class and month' };
    for (let attempt = 0; attempt < 3; attempt++) {
      const [voucherNo] = await this.nextNumber('V');
      try {
        const invoice = await this.prisma.$transaction(async (tx) => {
          const inv = await tx.feeInvoice.create({
            data: {
              studentId,
              period,
              dueDate: dueDate ? new Date(`${dueDate.slice(0, 10)}T00:00:00.000Z`) : new Date(`${calc.dueDate}T00:00:00.000Z`),
              totalAmount: calc.total,
              discountTotal: calc.discountTotal,
              prevBalance: calc.prevBalance,
              lineItems: calc.lines as unknown as Prisma.InputJsonValue,
              voucherNo,
              sectionId: calc.sectionId,
              classLabel: calc.classLabel,
              status: calc.total > 0 ? InvoiceStatus.PENDING : InvoiceStatus.PAID,
            },
          });
          await this.markDiscountsUsed(tx, calc.lines, period);
          return inv;
        });
        return { invoice, created: true, reason: null };
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002' && attempt < 2) continue;
        throw e;
      }
    }
    throw new ConflictException('Could not allocate a voucher number — try again.');
  }

  /** PDF1 3.3: challan for one student, a class, or all admitted students. */
  async generate(dto: GenerateChallansDto) {
    let studentIds: string[] = [];
    if (dto.scope === 'STUDENT') {
      if (!dto.studentId) throw new BadRequestException({ message: 'Choose the student.', fields: { studentId: 'Required' } });
      studentIds = [dto.studentId];
    } else {
      if (dto.scope === 'CLASS' && !dto.sectionId) throw new BadRequestException({ message: 'Choose the class.', fields: { sectionId: 'Required' } });
      const enr = await this.prisma.studentEnrollment.findMany({
        where: {
          status: 'ACTIVE',
          academicYear: { isCurrent: true },
          student: { dischargedAt: null },
          ...(dto.scope === 'CLASS' ? { sectionId: dto.sectionId } : {}),
        },
        select: { studentId: true },
      });
      studentIds = enr.map((e) => e.studentId);
    }
    const created: string[] = [];
    const skipped: { studentId: string; reason: string }[] = [];
    for (const id of studentIds) {
      try {
        const r = await this.createChallan(id, dto.period, dto.feeTypeIds?.length ? dto.feeTypeIds : null, dto.dueDate);
        if (r.created && r.invoice) created.push(r.invoice.id);
        else skipped.push({ studentId: id, reason: r.reason ?? 'skipped' });
      } catch (e) {
        if (dto.scope === 'STUDENT') throw e;
        skipped.push({ studentId: id, reason: e instanceof Error ? e.message : 'failed' });
      }
    }
    const names = skipped.length
      ? await this.prisma.studentProfile.findMany({ where: { id: { in: skipped.map((s) => s.studentId) } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } })
      : [];
    return {
      created: created.length,
      challanIds: created,
      skipped: skipped.map((s) => ({ ...s, name: name(names.find((n) => n.id === s.studentId)?.user) })),
    };
  }

  /** PDF1 3.3 "Generate Single Family Voucher": each child's challan for the month on one family voucher number. */
  async generateFamily(dto: FamilyChallanDto) {
    const fam = (await this.families()).find((f) => f.children.some((c) => c.studentId === dto.studentId));
    if (!fam) throw new BadRequestException('This student is not enrolled in a class this year.');
    const invoices: { id: string; familyVoucherNo: string | null }[] = [];
    for (const c of fam.children) {
      const r = await this.createChallan(c.studentId, dto.period, dto.feeTypeIds?.length ? dto.feeTypeIds : null, dto.dueDate);
      if (r.invoice) invoices.push(r.invoice);
    }
    if (!invoices.length) throw new BadRequestException('No challans could be made for this family (no fee types for their classes?).');
    const familyVoucherNo = invoices.find((i) => i.familyVoucherNo)?.familyVoucherNo ?? (await this.nextNumber('FV'))[0];
    await this.prisma.feeInvoice.updateMany({ where: { id: { in: invoices.map((i) => i.id) } }, data: { familyVoucherNo } });
    return this.familyVoucher(familyVoucherNo);
  }

  private invoiceInclude = {
    payments: { orderBy: { paidAt: 'asc' as const }, select: { id: true, amount: true, paidAt: true, method: true, reference: true, slipNo: true } },
    student: {
      select: {
        id: true,
        admissionNo: true,
        user: { select: { firstName: true, lastName: true, phone: true } },
        parents: {
          select: { relation: true, parent: { select: { user: { select: { firstName: true, lastName: true, phone: true } } } } },
        },
        enrollments: {
          where: { status: 'ACTIVE' as const, academicYear: { isCurrent: true } },
          take: 1,
          select: { rollNumber: true },
        },
      },
    },
  };

  private challanView(
    inv: Prisma.FeeInvoiceGetPayload<{ include: FinanceService['invoiceInclude'] }>,
    arrearsNow?: number,
  ) {
    const father = inv.student.parents.find((p) => p.relation === 'FATHER')?.parent.user;
    const mother = inv.student.parents.find((p) => p.relation === 'MOTHER')?.parent.user;
    const total = round2(inv.totalAmount + inv.lateFee);
    return {
      id: inv.id,
      voucherNo: inv.voucherNo,
      familyVoucherNo: inv.familyVoucherNo,
      period: inv.period,
      dueDate: inv.dueDate.toISOString().slice(0, 10),
      reminderDate: inv.reminderDate ? inv.reminderDate.toISOString().slice(0, 10) : null,
      status: STATUS_LABEL[inv.status],
      lines: (inv.lineItems ?? []) as unknown as ChallanLine[],
      amount: inv.totalAmount,
      lateFee: inv.lateFee,
      discountTotal: inv.discountTotal,
      prevBalance: inv.prevBalance,
      prevRemaining: arrearsNow ?? 0,
      total,
      paid: inv.amountPaid,
      balance: round2(total - inv.amountPaid),
      classLabel: inv.classLabel,
      sectionId: inv.sectionId,
      student: {
        id: inv.student.id,
        name: name(inv.student.user),
        admissionNo: inv.student.admissionNo,
        rollNumber: inv.student.enrollments[0]?.rollNumber ?? null,
        phone: inv.student.user.phone,
      },
      father: father ? { name: name(father), phone: father.phone } : null,
      mother: mother ? { name: name(mother), phone: mother.phone } : null,
      payments: inv.payments,
    };
  }

  /** Unpaid balance of each student's challans from months before `period` (the "Prev Remaining" column). */
  private async arrears(studentIds: string[]) {
    const open = await this.prisma.feeInvoice.findMany({
      where: { studentId: { in: studentIds }, status: { in: OPEN } },
      select: { studentId: true, period: true, totalAmount: true, lateFee: true, amountPaid: true },
    });
    return (studentId: string, period: string) =>
      round2(
        open
          .filter((o) => o.studentId === studentId && o.period < period)
          .reduce((n, o) => n + o.totalAmount + o.lateFee - o.amountPaid, 0),
      );
  }

  /** PDF1 4.1 list of challans (search by name / voucher no., filter by class, status, fee type, month). */
  async listChallans(q: ChallansQueryDto) {
    const { skip, take, page, limit } = getSkipTake(q);
    const s = q.search?.trim();
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const where: Prisma.FeeInvoiceWhereInput = {
      status: q.status === 'PAID' ? InvoiceStatus.PAID : q.status === 'PARTIAL' ? InvoiceStatus.PARTIAL : q.status === 'UNPAID' ? { in: [InvoiceStatus.PENDING, InvoiceStatus.OVERDUE] } : { not: InvoiceStatus.CANCELLED },
      ...(q.sectionId ? { sectionId: q.sectionId } : {}),
      ...(q.period ? { period: q.period } : {}),
      ...(q.feeTypeId ? { lineItems: { array_contains: [{ feeTypeId: q.feeTypeId }] } } : {}),
      ...(q.remindersDue === 'true' ? { reminderDate: { lte: today }, status: { in: OPEN } } : {}),
      ...(s
        ? {
            OR: [
              { voucherNo: { contains: s, mode: 'insensitive' } },
              { familyVoucherNo: { contains: s, mode: 'insensitive' } },
              { student: { admissionNo: { contains: s, mode: 'insensitive' } } },
              { student: { user: { firstName: { contains: s, mode: 'insensitive' } } } },
              { student: { user: { lastName: { contains: s, mode: 'insensitive' } } } },
              { student: { parents: { some: { relation: 'FATHER', parent: { user: { firstName: { contains: s, mode: 'insensitive' } } } } } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.feeInvoice.count({ where }),
      this.prisma.feeInvoice.findMany({
        where,
        skip,
        take,
        orderBy: [{ period: 'desc' }, { classLabel: 'asc' }, { voucherNo: 'asc' }],
        include: this.invoiceInclude,
      }),
    ]);
    const arrearsOf = await this.arrears([...new Set(rows.map((r) => r.studentId))]);
    const sums = await this.prisma.feeInvoice.aggregate({ where, _sum: { totalAmount: true, lateFee: true, amountPaid: true } });
    const result = paginate(
      rows.map((r) => this.challanView(r, arrearsOf(r.studentId, r.period))),
      total,
      page,
      limit,
    );
    return {
      ...result,
      meta: {
        ...result.meta,
        totals: {
          total: round2((sums._sum.totalAmount ?? 0) + (sums._sum.lateFee ?? 0)),
          paid: round2(sums._sum.amountPaid ?? 0),
          balance: round2((sums._sum.totalAmount ?? 0) + (sums._sum.lateFee ?? 0) - (sums._sum.amountPaid ?? 0)),
        },
      },
    };
  }

  async getChallan(id: string) {
    const inv = await this.prisma.feeInvoice.findUnique({ where: { id }, include: this.invoiceInclude });
    if (!inv) throw new NotFoundException('Challan not found');
    const arrearsOf = await this.arrears([inv.studentId]);
    return { ...this.challanView(inv, arrearsOf(inv.studentId, inv.period)), settings: await this.getSettings() };
  }

  async familyVoucher(familyVoucherNo: string) {
    const rows = await this.prisma.feeInvoice.findMany({ where: { familyVoucherNo }, include: this.invoiceInclude, orderBy: { voucherNo: 'asc' } });
    if (!rows.length) throw new NotFoundException('Family voucher not found');
    const arrearsOf = await this.arrears(rows.map((r) => r.studentId));
    const challans = rows.map((r) => this.challanView(r, arrearsOf(r.studentId, r.period)));
    return {
      familyVoucherNo,
      period: rows[0].period,
      dueDate: rows[0].dueDate.toISOString().slice(0, 10),
      father: challans.find((c) => c.father)?.father ?? null,
      challans,
      total: round2(challans.reduce((n, c) => n + c.total, 0)),
      prevRemaining: round2(challans.reduce((n, c) => n + c.prevRemaining, 0)),
      balance: round2(challans.reduce((n, c) => n + c.balance, 0)),
      settings: await this.getSettings(),
    };
  }

  /** "Regenerate": rebuild the lines from today's fee types and discounts (only before any payment). */
  async regenerate(id: string) {
    const inv = await this.prisma.feeInvoice.findUnique({ where: { id }, include: { _count: { select: { payments: true } } } });
    if (!inv) throw new NotFoundException('Challan not found');
    if (inv._count.payments) throw new ConflictException('This challan has payments, so it can no longer be regenerated.');
    const oldLines = (inv.lineItems ?? []) as unknown as ChallanLine[];
    const keepTypes = oldLines.map((l) => l.feeTypeId);
    await this.prisma.$transaction(async (tx) => this.markDiscountsUsed(tx, oldLines, inv.period, true));
    const calc = await this.calculate(inv.studentId, inv.period, keepTypes.length ? keepTypes : null);
    await this.prisma.$transaction(async (tx) => {
      await tx.feeInvoice.update({
        where: { id },
        data: {
          totalAmount: calc.total,
          discountTotal: calc.discountTotal,
          prevBalance: calc.prevBalance,
          lineItems: calc.lines as unknown as Prisma.InputJsonValue,
          sectionId: calc.sectionId,
          classLabel: calc.classLabel,
          lateFee: 0,
          status: calc.total > 0 ? InvoiceStatus.PENDING : InvoiceStatus.PAID,
        },
      });
      await this.markDiscountsUsed(tx, calc.lines, inv.period);
    });
    return this.getChallan(id);
  }

  async setReminder(id: string, reminderDate: string | null | undefined) {
    const inv = await this.prisma.feeInvoice.findUnique({ where: { id }, select: { id: true } });
    if (!inv) throw new NotFoundException('Challan not found');
    await this.prisma.feeInvoice.update({
      where: { id },
      data: { reminderDate: reminderDate ? new Date(`${reminderDate.slice(0, 10)}T00:00:00.000Z`) : null },
    });
    return this.getChallan(id);
  }

  /** "Delete Voucher": only while nothing has been paid on it. */
  async deleteChallan(id: string) {
    const inv = await this.prisma.feeInvoice.findUnique({ where: { id }, include: { _count: { select: { payments: true } } } });
    if (!inv) throw new NotFoundException('Challan not found');
    if (inv._count.payments) throw new ConflictException('This challan has payments, so it can\'t be deleted.');
    await this.prisma.$transaction(async (tx) => {
      await this.markDiscountsUsed(tx, (inv.lineItems ?? []) as unknown as ChallanLine[], inv.period, true);
      await tx.feeInvoice.delete({ where: { id } });
    });
    return { success: true as const };
  }

  /** "Missing Voucher": active students of the current year with no challan for the month. */
  async missingVouchers(q: MissingVouchersQueryDto) {
    const enr = await this.prisma.studentEnrollment.findMany({
      where: {
        status: 'ACTIVE',
        academicYear: { isCurrent: true },
        student: { dischargedAt: null, invoices: { none: { period: q.period } } },
        ...(q.sectionId ? { sectionId: q.sectionId } : {}),
      },
      select: {
        rollNumber: true,
        section: { select: { id: true, name: true, class: { select: { name: true, level: true } } } },
        student: { select: { id: true, admissionNo: true, user: { select: { firstName: true, lastName: true } } } },
      },
    });
    return enr
      .map((e) => ({
        studentId: e.student.id,
        name: name(e.student.user),
        admissionNo: e.student.admissionNo,
        sectionId: e.section.id,
        classLabel: `${e.section.class.name} · ${e.section.name}`,
        rollNumber: e.rollNumber,
        level: e.section.class.level,
      }))
      .sort((a, b) => a.level - b.level || a.classLabel.localeCompare(b.classLabel) || (a.rollNumber ?? '').localeCompare(b.rollNumber ?? '', undefined, { numeric: true }))
      .map(({ level: _l, ...r }) => r);
  }

  // ---------- collection ----------
  /**
   * Collect a payment for the challan's student: paid towards their open challans oldest first (arrears before this month).
   * A challan paid after its due date gets the late fee once (when enabled). Returns the fee slip number.
   */
  async collect(id: string, dto: CollectFeeDto, admin: AuthUser) {
    const inv = await this.prisma.feeInvoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Challan not found');
    if (inv.status === InvoiceStatus.CANCELLED) throw new BadRequestException('This challan is cancelled.');
    const settings = await this.getSettings();
    const paidAt = new Date(`${dto.paidAt.slice(0, 10)}T00:00:00.000Z`);
    const open = await this.prisma.feeInvoice.findMany({
      where: { studentId: inv.studentId, status: { in: OPEN }, period: { lte: inv.period } },
      orderBy: { period: 'asc' },
    });
    if (!open.length) throw new BadRequestException('Nothing is due on this challan.');
    const plan = open.map((o) => {
      const lateFee =
        o.lateFee === 0 && settings.lateFeeEnabled && settings.lateFeeAmount > 0 && paidAt > o.dueDate ? settings.lateFeeAmount : o.lateFee;
      return { inv: o, lateFee, due: round2(o.totalAmount + lateFee - o.amountPaid) };
    });
    const due = round2(plan.reduce((n, p) => n + p.due, 0));
    if (dto.amount > due + 0.001) {
      throw new BadRequestException({ message: `That is more than the amount due (${settings.currencySymbol} ${due}).`, fields: { amount: `At most ${due}` } });
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const [slipNo] = await this.nextNumber('R');
      try {
        const allocations = await this.prisma.$transaction(async (tx) => {
          let left = round2(dto.amount);
          const out: { invoiceId: string; voucherNo: string | null; period: string; amount: number; status: string }[] = [];
          for (const p of plan) {
            if (left <= 0) break;
            const pay = round2(Math.min(left, p.due));
            if (pay <= 0) continue;
            left = round2(left - pay);
            await tx.feePayment.create({
              data: { invoiceId: p.inv.id, amount: pay, paidAt, method: dto.method, reference: dto.reference?.trim() || null, slipNo, recordedById: admin.id },
            });
            const paid = round2(p.inv.amountPaid + pay);
            const total = round2(p.inv.totalAmount + p.lateFee);
            const status = paid >= total - 0.001 ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL;
            await tx.feeInvoice.update({ where: { id: p.inv.id }, data: { amountPaid: paid, lateFee: p.lateFee, status } });
            out.push({ invoiceId: p.inv.id, voucherNo: p.inv.voucherNo, period: p.inv.period, amount: pay, status: STATUS_LABEL[status] });
          }
          return out;
        });
        return { slipNo, allocations, challan: await this.getChallan(id) };
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002' && attempt < 2) continue;
        throw e;
      }
    }
    throw new ConflictException('Could not save the payment — try again.');
  }

  /** "Fee Slip": the receipt of one collection. */
  async feeSlip(slipNo: string) {
    const payments = await this.prisma.feePayment.findMany({
      where: { slipNo },
      orderBy: { createdAt: 'asc' },
      include: {
        recordedBy: { select: { firstName: true, lastName: true } },
        invoice: { include: this.invoiceInclude },
      },
    });
    if (!payments.length) throw new NotFoundException('Fee slip not found');
    const inv = payments[0].invoice;
    const open = await this.prisma.feeInvoice.findMany({
      where: { studentId: inv.studentId, status: { in: OPEN } },
      select: { totalAmount: true, lateFee: true, amountPaid: true },
    });
    const father = inv.student.parents.find((p) => p.relation === 'FATHER')?.parent.user;
    return {
      slipNo,
      paidAt: payments[0].paidAt.toISOString().slice(0, 10),
      method: payments[0].method,
      reference: payments[0].reference,
      receivedBy: name(payments[0].recordedBy),
      student: { name: name(inv.student.user), admissionNo: inv.student.admissionNo, classLabel: inv.classLabel, rollNumber: inv.student.enrollments[0]?.rollNumber ?? null },
      father: father ? { name: name(father), phone: father.phone } : null,
      items: payments.map((p) => ({ voucherNo: p.invoice.voucherNo, period: p.invoice.period, amount: p.amount })),
      total: round2(payments.reduce((n, p) => n + p.amount, 0)),
      remaining: round2(open.reduce((n, o) => n + o.totalAmount + o.lateFee - o.amountPaid, 0)),
      settings: await this.getSettings(),
    };
  }
}
