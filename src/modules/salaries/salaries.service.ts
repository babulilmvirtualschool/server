import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Campus, Prisma, SalaryStatus } from '@prisma/client';
import { currentCampus } from '../../common/campus/campus-context';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdvancesQueryDto,
  AnnualSalariesQueryDto,
  CreateAdvanceDto,
  CreateFineDto,
  CreateSalaryStructureDto,
  FinesQueryDto,
  GenerateSalariesDto,
  PaySalaryDto,
  SalariesQueryDto,
} from './dto/salary.dto';

type Item = { name: string; amount: number };
type Breakdown = {
  base: number;
  allowances: Item[];
  deductions: Item[];
  fines: { id: string; reason: string; amount: number }[];
  advances: { id: string; amount: number }[];
  allowanceTotal: number;
  deductionTotal: number;
  fineTotal: number;
  advanceTotal: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (items: { amount: number }[]) => round2(items.reduce((n, i) => n + (Number(i.amount) || 0), 0));
const name = (u?: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}`.trim() : '');
const utcDay = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00.000Z`);
const monthEnd = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0));
};

const teacherSelect = {
  id: true,
  employeeCode: true,
  designation: true,
  cnic: true,
  user: { select: { firstName: true, lastName: true, phone: true, role: true, isActive: true } },
} satisfies Prisma.TeacherProfileSelect;
type TeacherRow = Prisma.TeacherProfileGetPayload<{ select: typeof teacherSelect }>;

/**
 * Staff salaries (PDF1 6.1 + PDF2 Teacher "9. Pay"): assign salary (base + allowances − deductions), monthly generation
 * with that month's fines and advance recovery, part / full payment, pay slip, advances and fines. Teachers and
 * non-teaching staff (both have a TeacherProfile) are treated the same.
 */
@Injectable()
export class SalariesService {
  constructor(private readonly prisma: PrismaService) {}

  private teacherView(t: TeacherRow) {
    return {
      id: t.id,
      name: name(t.user),
      employeeCode: t.employeeCode,
      designation: t.designation ?? (t.user.role === 'TEACHER' ? 'Teacher' : null),
      kind: t.user.role === 'STAFF' ? 'NON_TEACHING' : 'TEACHING',
      phone: t.user.phone,
    };
  }

  private async currency() {
    return (await this.prisma.feeSettings.findFirst({ select: { currencySymbol: true } }))?.currencySymbol ?? 'Rs.';
  }

  // ---------- assign salary ----------
  /** Active teachers and staff with their current salary and outstanding advance. */
  async staff() {
    const today = new Date();
    const rows = await this.prisma.teacherProfile.findMany({
      where: { user: { isActive: true, role: { in: ['TEACHER', 'STAFF'] } } },
      select: {
        ...teacherSelect,
        salaryStructures: { orderBy: { effectiveFrom: 'desc' }, take: 3 },
        salaryAdvances: { select: { amount: true, recovered: true } },
      },
    });
    return rows
      .map((t) => {
        const current = t.salaryStructures.find((s) => s.effectiveFrom <= today) ?? t.salaryStructures[t.salaryStructures.length - 1] ?? null;
        const allowances = (current?.allowances ?? []) as unknown as Item[];
        const deductions = (current?.deductions ?? []) as unknown as Item[];
        return {
          ...this.teacherView(t),
          salary: current
            ? {
                id: current.id,
                baseSalary: current.baseSalary,
                allowances,
                deductions,
                effectiveFrom: current.effectiveFrom.toISOString().slice(0, 10),
                monthlyNet: round2(current.baseSalary + sum(allowances) - sum(deductions)),
              }
            : null,
          advanceBalance: round2(t.salaryAdvances.reduce((n, a) => n + a.amount - a.recovered, 0)),
        };
      })
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'TEACHING' ? -1 : 1));
  }

  async assign(dto: CreateSalaryStructureDto) {
    const t = await this.prisma.teacherProfile.findUnique({ where: { id: dto.teacherId }, select: { id: true } });
    if (!t) throw new NotFoundException('Teacher / staff member not found');
    const from = utcDay(dto.effectiveFrom);
    const clean = (items?: Item[]) => (items ?? []).map((i) => ({ name: i.name.trim(), amount: round2(i.amount) })).filter((i) => i.name && i.amount > 0);
    const data = { baseSalary: round2(dto.baseSalary), allowances: clean(dto.allowances), deductions: clean(dto.deductions) };
    return this.prisma.$transaction(async (tx) => {
      const same = await tx.teacherSalaryStructure.findFirst({ where: { teacherId: t.id, effectiveFrom: from } });
      if (same) return tx.teacherSalaryStructure.update({ where: { id: same.id }, data });
      await tx.teacherSalaryStructure.updateMany({
        where: { teacherId: t.id, effectiveFrom: { lt: from }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] },
        data: { effectiveTo: new Date(from.getTime() - 86_400_000) },
      });
      return tx.teacherSalaryStructure.create({ data: { teacherId: t.id, effectiveFrom: from, ...data } });
    });
  }

  listStructuresForTeacher(teacherId: string) {
    return this.prisma.teacherSalaryStructure.findMany({ where: { teacherId }, orderBy: { effectiveFrom: 'desc' } });
  }

  // ---------- generate ----------
  private async nextSlipNos(count: number) {
    const prefix = `${(currentCampus() ?? Campus.ONLINE) === Campus.PHYSICAL ? 'PH' : 'ON'}-S-`;
    const last = (await this.prisma.salaryPayment.findFirst({ where: { slipNo: { startsWith: prefix } }, orderBy: { slipNo: 'desc' }, select: { slipNo: true } }))?.slipNo;
    const n = last ? parseInt(last.slice(prefix.length), 10) || 0 : 0;
    return Array.from({ length: count }, (_, i) => `${prefix}${String(n + i + 1).padStart(6, '0')}`);
  }

  /** Salary of one person for one month: assigned salary, that month's fines, advance recovery (never below zero). */
  private async build(teacherId: string, period: string, tx: Prisma.TransactionClient) {
    const end = monthEnd(period);
    const structure = await tx.teacherSalaryStructure.findFirst({ where: { teacherId, effectiveFrom: { lte: end } }, orderBy: { effectiveFrom: 'desc' } });
    if (!structure) return null;
    const allowances = (structure.allowances ?? []) as unknown as Item[];
    const deductions = (structure.deductions ?? []) as unknown as Item[];
    const fines = await tx.salaryFine.findMany({ where: { teacherId, period }, orderBy: { createdAt: 'asc' } });
    const gross = round2(structure.baseSalary + sum(allowances));
    let room = Math.max(0, round2(gross - sum(deductions) - sum(fines)));
    const advances: { id: string; amount: number }[] = [];
    const open = await tx.salaryAdvance.findMany({ where: { teacherId, givenOn: { lte: end } }, orderBy: { givenOn: 'asc' } });
    for (const a of open) {
      const left = round2(a.amount - a.recovered);
      if (left <= 0 || room <= 0) continue;
      const take = round2(Math.min(left, a.monthlyDeduction > 0 ? a.monthlyDeduction : left, room));
      if (take <= 0) continue;
      advances.push({ id: a.id, amount: take });
      room = round2(room - take);
    }
    const breakdown: Breakdown = {
      base: structure.baseSalary,
      allowances,
      deductions,
      fines: fines.map((f) => ({ id: f.id, reason: f.reason, amount: f.amount })),
      advances,
      allowanceTotal: sum(allowances),
      deductionTotal: sum(deductions),
      fineTotal: sum(fines),
      advanceTotal: sum(advances),
    };
    return { gross, net: room, breakdown };
  }

  private async createSalary(tx: Prisma.TransactionClient, teacherId: string, period: string, slipNo: string) {
    const built = await this.build(teacherId, period, tx);
    if (!built) return null;
    for (const a of built.breakdown.advances) await tx.salaryAdvance.update({ where: { id: a.id }, data: { recovered: { increment: a.amount } } });
    return tx.salaryPayment.create({
      data: {
        teacherId,
        period,
        slipNo,
        grossAmount: built.gross,
        netAmount: built.net,
        breakdown: built.breakdown as unknown as Prisma.InputJsonValue,
        status: built.net <= 0 ? SalaryStatus.PAID : SalaryStatus.UNPAID,
      },
    });
  }

  private async undoAdvances(tx: Prisma.TransactionClient, breakdown: unknown) {
    for (const a of ((breakdown as Breakdown | null)?.advances ?? [])) {
      await tx.salaryAdvance.updateMany({ where: { id: a.id }, data: { recovered: { decrement: a.amount } } });
    }
  }

  async generate(dto: GenerateSalariesDto) {
    const staff = await this.prisma.teacherProfile.findMany({
      where: { user: { isActive: true, role: { in: ['TEACHER', 'STAFF'] } }, ...(dto.teacherIds?.length ? { id: { in: dto.teacherIds } } : {}) },
      select: { ...teacherSelect, salaryPayments: { where: { period: dto.period }, select: { id: true } } },
    });
    const skipped: { teacherId: string; name: string; reason: string }[] = [];
    const todo: TeacherRow[] = [];
    for (const t of staff) {
      if (t.salaryPayments.length) skipped.push({ teacherId: t.id, name: name(t.user), reason: 'Salary already generated for this month' });
      else todo.push(t);
    }
    const slips = await this.nextSlipNos(todo.length);
    let created = 0;
    for (const [i, t] of todo.entries()) {
      const row = await this.prisma.$transaction((tx) => this.createSalary(tx, t.id, dto.period, slips[i]));
      if (row) created++;
      else skipped.push({ teacherId: t.id, name: name(t.user), reason: 'No salary assigned' });
    }
    return { period: dto.period, created, skipped };
  }

  // ---------- salary record ----------
  private salaryInclude = { teacher: { select: teacherSelect } } as const;

  private salaryView(s: Prisma.SalaryPaymentGetPayload<{ include: SalariesService['salaryInclude'] }>) {
    const b = (s.breakdown ?? {}) as Partial<Breakdown>;
    return {
      id: s.id,
      slipNo: s.slipNo,
      period: s.period,
      teacher: this.teacherView(s.teacher),
      base: b.base ?? s.grossAmount,
      allowances: b.allowances ?? [],
      deductions: b.deductions ?? [],
      fines: b.fines ?? [],
      advances: b.advances ?? [],
      allowanceTotal: b.allowanceTotal ?? 0,
      deductionTotal: b.deductionTotal ?? 0,
      fineTotal: b.fineTotal ?? 0,
      advanceTotal: b.advanceTotal ?? 0,
      gross: s.grossAmount,
      net: s.netAmount,
      paid: s.paidAmount,
      pending: round2(Math.max(0, s.netAmount - s.paidAmount)),
      status: s.status,
      paidAt: s.paidAt ? s.paidAt.toISOString().slice(0, 10) : null,
      method: s.method,
      reference: s.reference,
      generatedAt: s.createdAt.toISOString().slice(0, 10),
    };
  }

  async list(q: SalariesQueryDto) {
    const rows = await this.prisma.salaryPayment.findMany({
      where: {
        ...(q.period ? { period: q.period } : {}),
        ...(q.teacherId ? { teacherId: q.teacherId } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      include: this.salaryInclude,
      orderBy: [{ period: 'desc' }, { slipNo: 'asc' }],
      take: 2000,
    });
    const out = rows.map((r) => this.salaryView(r));
    return {
      rows: out,
      currency: await this.currency(),
      totals: {
        net: round2(out.reduce((n, r) => n + r.net, 0)),
        paid: round2(out.reduce((n, r) => n + r.paid, 0)),
        pending: round2(out.reduce((n, r) => n + r.pending, 0)),
      },
    };
  }

  /** "Annual" view: every staff member × the 12 months of a calendar year. */
  async annual(q: AnnualSalariesQueryDto) {
    const months = Array.from({ length: 12 }, (_, i) => `${q.year}-${String(i + 1).padStart(2, '0')}`);
    const rows = await this.prisma.salaryPayment.findMany({
      where: { period: { gte: months[0], lte: months[11] } },
      include: this.salaryInclude,
    });
    const byTeacher = new Map<string, { teacher: ReturnType<SalariesService['teacherView']>; months: Record<string, { net: number; paid: number; status: string }>; net: number; paid: number }>();
    for (const r of rows) {
      const row = byTeacher.get(r.teacherId) ?? { teacher: this.teacherView(r.teacher), months: {}, net: 0, paid: 0 };
      row.months[r.period] = { net: r.netAmount, paid: r.paidAmount, status: r.status };
      row.net = round2(row.net + r.netAmount);
      row.paid = round2(row.paid + r.paidAmount);
      byTeacher.set(r.teacherId, row);
    }
    return {
      year: q.year,
      months,
      currency: await this.currency(),
      rows: [...byTeacher.values()].sort((a, b) => a.teacher.name.localeCompare(b.teacher.name)),
    };
  }

  async pay(id: string, dto: PaySalaryDto, admin: AuthUser) {
    const s = await this.prisma.salaryPayment.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Salary not found');
    const pending = round2(s.netAmount - s.paidAmount);
    if (pending <= 0) throw new BadRequestException('This salary is already paid in full.');
    if (dto.amount > pending + 0.001) throw new BadRequestException({ message: `Only ${pending} is pending on this salary.`, fields: { amount: `At most ${pending}` } });
    const paid = round2(s.paidAmount + dto.amount);
    await this.prisma.salaryPayment.update({
      where: { id },
      data: {
        paidAmount: paid,
        status: paid >= s.netAmount - 0.001 ? SalaryStatus.PAID : SalaryStatus.PARTIAL,
        paidAt: utcDay(dto.paidAt),
        method: dto.method,
        reference: dto.reference?.trim() || null,
        paidById: admin.id,
      },
    });
    return this.slip(id);
  }

  private async unpaidOrThrow(id: string) {
    const s = await this.prisma.salaryPayment.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Salary not found');
    if (s.paidAmount > 0) throw new ConflictException('This salary has payments, so it can no longer be changed.');
    return s;
  }

  /** Rebuild an unpaid salary from today's assigned salary, fines and advances (keeps its slip no.). */
  async regenerate(id: string) {
    const s = await this.unpaidOrThrow(id);
    await this.prisma.$transaction(async (tx) => {
      await this.undoAdvances(tx, s.breakdown);
      await tx.salaryPayment.delete({ where: { id } });
      const row = await this.createSalary(tx, s.teacherId, s.period, s.slipNo ?? (await this.nextSlipNos(1))[0]);
      if (!row) throw new BadRequestException('No salary is assigned for this month any more.');
    });
    const fresh = await this.prisma.salaryPayment.findUnique({ where: { teacherId_period: { teacherId: s.teacherId, period: s.period } }, include: this.salaryInclude });
    return this.salaryView(fresh!);
  }

  async remove(id: string) {
    const s = await this.unpaidOrThrow(id);
    await this.prisma.$transaction(async (tx) => {
      await this.undoAdvances(tx, s.breakdown);
      await tx.salaryPayment.delete({ where: { id } });
    });
    return { deleted: true };
  }

  // ---------- pay slip ----------
  async slip(id: string, user?: AuthUser) {
    const s = await this.prisma.salaryPayment.findUnique({ where: { id }, include: { teacher: { select: { ...teacherSelect, userId: true } } } });
    if (!s) throw new NotFoundException('Salary not found');
    if (user && s.teacher.userId !== user.id) throw new ForbiddenException();
    const { userId: _u, ...teacher } = s.teacher;
    return { ...this.salaryView({ ...s, teacher }), cnic: teacher.cnic, currency: await this.currency() };
  }

  // ---------- advances ----------
  async advances(q: AdvancesQueryDto) {
    const rows = await this.prisma.salaryAdvance.findMany({
      where: {
        ...(q.teacherId ? { teacherId: q.teacherId } : {}),
        ...(q.from || q.to ? { givenOn: { ...(q.from ? { gte: utcDay(q.from) } : {}), ...(q.to ? { lte: utcDay(q.to) } : {}) } } : {}),
      },
      include: { teacher: { select: teacherSelect } },
      orderBy: { givenOn: 'desc' },
      take: 2000,
    });
    const out = rows
      .map((a) => ({
        id: a.id,
        teacher: this.teacherView(a.teacher),
        amount: a.amount,
        givenOn: a.givenOn.toISOString().slice(0, 10),
        monthlyDeduction: a.monthlyDeduction,
        recovered: a.recovered,
        remaining: round2(a.amount - a.recovered),
        method: a.method,
        note: a.note,
      }))
      .filter((a) => !q.status || (q.status === 'OPEN' ? a.remaining > 0 : a.remaining <= 0));
    return {
      rows: out,
      currency: await this.currency(),
      totals: {
        amount: round2(out.reduce((n, r) => n + r.amount, 0)),
        recovered: round2(out.reduce((n, r) => n + r.recovered, 0)),
        remaining: round2(out.reduce((n, r) => n + r.remaining, 0)),
      },
    };
  }

  async createAdvance(dto: CreateAdvanceDto) {
    const t = await this.prisma.teacherProfile.findUnique({ where: { id: dto.teacherId }, select: { id: true } });
    if (!t) throw new NotFoundException('Teacher / staff member not found');
    if ((dto.monthlyDeduction ?? 0) > dto.amount) {
      throw new BadRequestException({ message: 'Monthly deduction is more than the advance.', fields: { monthlyDeduction: 'Must not be more than the advance' } });
    }
    return this.prisma.salaryAdvance.create({
      data: {
        teacherId: t.id,
        amount: round2(dto.amount),
        givenOn: utcDay(dto.givenOn),
        monthlyDeduction: round2(dto.monthlyDeduction ?? 0),
        method: dto.method ?? 'CASH',
        note: dto.note?.trim() || null,
      },
    });
  }

  async deleteAdvance(id: string) {
    const a = await this.prisma.salaryAdvance.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Advance not found');
    if (a.recovered > 0) throw new ConflictException('Part of this advance is already recovered from a salary, so it can no longer be deleted.');
    await this.prisma.salaryAdvance.delete({ where: { id } });
    return { deleted: true };
  }

  // ---------- fines ----------
  async fines(q: FinesQueryDto) {
    const rows = await this.prisma.salaryFine.findMany({
      where: { ...(q.period ? { period: q.period } : {}), ...(q.teacherId ? { teacherId: q.teacherId } : {}) },
      include: { teacher: { select: teacherSelect } },
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
      take: 2000,
    });
    return {
      rows: rows.map((f) => ({ id: f.id, teacher: this.teacherView(f.teacher), period: f.period, amount: f.amount, reason: f.reason, createdAt: f.createdAt.toISOString().slice(0, 10) })),
      currency: await this.currency(),
      total: round2(rows.reduce((n, f) => n + f.amount, 0)),
    };
  }

  /** A month whose salary is already generated: refused once paid, otherwise the salary is rebuilt with the change. */
  private async afterFineChange(teacherId: string, period: string, change: () => Promise<unknown>) {
    const s = await this.prisma.salaryPayment.findUnique({ where: { teacherId_period: { teacherId, period } } });
    if (s && s.paidAmount > 0) throw new ConflictException('This month’s salary already has payments, so its fines can no longer change.');
    const out = await change();
    if (s) await this.regenerate(s.id);
    return out;
  }

  async createFine(dto: CreateFineDto) {
    const t = await this.prisma.teacherProfile.findUnique({ where: { id: dto.teacherId }, select: { id: true } });
    if (!t) throw new NotFoundException('Teacher / staff member not found');
    return this.afterFineChange(t.id, dto.period, () =>
      this.prisma.salaryFine.create({ data: { teacherId: t.id, period: dto.period, amount: round2(dto.amount), reason: dto.reason.trim() } }),
    );
  }

  async deleteFine(id: string) {
    const f = await this.prisma.salaryFine.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('Fine not found');
    await this.afterFineChange(f.teacherId, f.period, () => this.prisma.salaryFine.delete({ where: { id } }));
    return { deleted: true };
  }

  // ---------- own pay page ----------
  private async ownTeacherId(userId: string) {
    const t = await this.prisma.teacherProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!t) throw new NotFoundException('Staff profile not found');
    return t.id;
  }

  /** PDF2 Teacher "9. Pay": monthly pay, every salary with received / pending / fines, pay slips, advances. */
  async mine(user: AuthUser) {
    const teacherId = await this.ownTeacherId(user.id);
    const [staff, list, fines, advances] = await Promise.all([
      this.staff(),
      this.list({ teacherId }),
      this.fines({ teacherId }),
      this.advances({ teacherId }),
    ]);
    const me = staff.find((s) => s.id === teacherId);
    return {
      currency: list.currency,
      salary: me?.salary ?? null,
      salaries: list.rows,
      fines: fines.rows,
      advances: advances.rows,
      totals: {
        monthlyPay: me?.salary?.monthlyNet ?? 0,
        received: list.totals.paid,
        pending: list.totals.pending,
        fines: fines.total,
        advanceBalance: advances.totals.remaining,
      },
    };
  }

  async paymentsForTeacherUser(userId: string) {
    return this.listPaymentsForTeacher(await this.ownTeacherId(userId));
  }

  listPaymentsForTeacher(teacherId: string) {
    return this.prisma.salaryPayment.findMany({ where: { teacherId }, orderBy: { period: 'desc' } });
  }
}
