import { Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { FeeLedgerQueryDto, FeeRegisterQueryDto, FeeReportQueryDto } from './dto/fee-reports.dto';
import { FinanceService } from './finance.service';

const round2 = (n: number) => Math.round(n * 100) / 100;
const name = (u?: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}`.trim() : '');
const OPEN: InvoiceStatus[] = [InvoiceStatus.PENDING, InvoiceStatus.PARTIAL, InvoiceStatus.OVERDUE];
const STATUS_LABEL: Record<InvoiceStatus, string> = { PENDING: 'UNPAID', OVERDUE: 'UNPAID', PARTIAL: 'PARTIAL', PAID: 'PAID', CANCELLED: 'CANCELLED' };
const todayIso = () => new Date().toISOString().slice(0, 10);
const utcDay = (d: string) => new Date(`${d}T00:00:00.000Z`);
const addMonths = (period: string, n: number) => {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

type ChallanLine = { name: string; amount: number; discount: number; siblingDiscount: number; net: number };

const studentSelect = {
  id: true,
  admissionNo: true,
  dischargedAt: true,
  user: { select: { firstName: true, lastName: true, phone: true } },
  parents: { select: { relation: true, parent: { select: { user: { select: { firstName: true, lastName: true, phone: true } } } } } },
  enrollments: {
    where: { status: 'ACTIVE' as const, academicYear: { isCurrent: true } },
    take: 1,
    select: { rollNumber: true },
  },
} satisfies Prisma.StudentProfileSelect;
type StudentRow = Prisma.StudentProfileGetPayload<{ select: typeof studentSelect }>;

/**
 * Day 7 fee reports (PDF1 4.2 Daily / Monthly / Outstanding / By type, 4.3 Fee register, 5.1 Fee record / ledger) and the
 * fee-defaulter check behind "Block Parent & Student Portal for Defaulter" (5.2).
 */
@Injectable()
export class FeeReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
  ) {}

  private father(s: StudentRow) {
    const f = s.parents.find((p) => p.relation === 'FATHER') ?? s.parents[0];
    return f ? { name: name(f.parent.user), phone: f.parent.user.phone } : null;
  }

  private studentView(s: StudentRow) {
    const father = this.father(s);
    return {
      id: s.id,
      name: name(s.user),
      admissionNo: s.admissionNo,
      rollNumber: s.enrollments[0]?.rollNumber ?? null,
      fatherName: father?.name ?? null,
      mobile: father?.phone ?? s.user.phone ?? null,
      discharged: !!s.dischargedAt,
    };
  }

  /** "Filter by Student | Family": the student alone, or every brother / sister sharing a parent. */
  private async studentScope(q: { studentId?: string; family?: string }) {
    if (!q.studentId) return null;
    if (q.family !== 'true') return [q.studentId];
    const fam = (await this.finance.families()).find((f) => f.children.some((c) => c.studentId === q.studentId));
    return fam ? fam.children.map((c) => c.studentId) : [q.studentId];
  }

  // ---------- 4.2 fee reports ----------
  async report(q: FeeReportQueryDto) {
    const ids = await this.studentScope(q);
    const settings = await this.finance.getSettings();
    const scope: Prisma.FeeInvoiceWhereInput = {
      status: { not: InvoiceStatus.CANCELLED },
      ...(ids ? { studentId: { in: ids } } : {}),
      ...(q.sectionId ? { sectionId: q.sectionId } : {}),
    };
    const base = { kind: q.kind, currency: settings.currencySymbol };

    if (q.kind === 'DAILY') {
      const date = q.date ?? todayIso();
      const payments = await this.prisma.feePayment.findMany({
        where: { paidAt: { gte: utcDay(date), lt: new Date(utcDay(date).getTime() + 86_400_000) }, invoice: scope },
        orderBy: [{ slipNo: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          slipNo: true,
          amount: true,
          method: true,
          reference: true,
          invoice: { select: { voucherNo: true, period: true, classLabel: true, student: { select: studentSelect } } },
        },
      });
      const bySlip = new Map<string, { slipNo: string | null; student: ReturnType<FeeReportsService['studentView']>; classLabel: string | null; vouchers: string[]; amount: number; method: string; reference: string | null }>();
      for (const p of payments) {
        const key = p.slipNo ?? p.id;
        const row = bySlip.get(key) ?? {
          slipNo: p.slipNo,
          student: this.studentView(p.invoice.student),
          classLabel: p.invoice.classLabel,
          vouchers: [],
          amount: 0,
          method: p.method,
          reference: p.reference,
        };
        row.vouchers.push(p.invoice.voucherNo ?? p.invoice.period);
        row.amount = round2(row.amount + p.amount);
        bySlip.set(key, row);
      }
      const rows = [...bySlip.values()];
      const byMethod: Record<string, number> = {};
      for (const r of rows) byMethod[r.method] = round2((byMethod[r.method] ?? 0) + r.amount);
      return { ...base, date, rows, totals: { slips: rows.length, collected: round2(rows.reduce((n, r) => n + r.amount, 0)), byMethod } };
    }

    if (q.kind === 'MONTHLY') {
      const month = q.month ?? todayIso().slice(0, 7);
      const [challans, collected] = await Promise.all([
        this.prisma.feeInvoice.findMany({
          where: { ...scope, period: month },
          select: { classLabel: true, totalAmount: true, lateFee: true, discountTotal: true, amountPaid: true, status: true },
        }),
        this.prisma.feePayment.aggregate({
          where: { paidAt: { gte: utcDay(`${month}-01`), lt: utcDay(`${addMonths(month, 1)}-01`) }, invoice: scope },
          _sum: { amount: true },
        }),
      ]);
      const byClass = new Map<string, { classLabel: string; challans: number; paid: number; unpaid: number; billed: number; discount: number; received: number; balance: number }>();
      for (const c of challans) {
        const label = c.classLabel ?? '—';
        const row = byClass.get(label) ?? { classLabel: label, challans: 0, paid: 0, unpaid: 0, billed: 0, discount: 0, received: 0, balance: 0 };
        const total = c.totalAmount + c.lateFee;
        row.challans++;
        if (c.status === InvoiceStatus.PAID) row.paid++;
        else row.unpaid++;
        row.billed = round2(row.billed + total);
        row.discount = round2(row.discount + c.discountTotal);
        row.received = round2(row.received + c.amountPaid);
        row.balance = round2(row.balance + total - c.amountPaid);
        byClass.set(label, row);
      }
      const rows = [...byClass.values()].sort((a, b) => a.classLabel.localeCompare(b.classLabel, undefined, { numeric: true }));
      const sum = (k: 'challans' | 'paid' | 'unpaid' | 'billed' | 'discount' | 'received' | 'balance') => round2(rows.reduce((n, r) => n + r[k], 0));
      return {
        ...base,
        month,
        rows,
        totals: {
          challans: sum('challans'),
          paid: sum('paid'),
          unpaid: sum('unpaid'),
          billed: sum('billed'),
          discount: sum('discount'),
          received: sum('received'),
          balance: sum('balance'),
          collectedThisMonth: round2(collected._sum.amount ?? 0),
        },
      };
    }

    if (q.kind === 'OUTSTANDING') {
      const open = await this.prisma.feeInvoice.findMany({
        where: { ...scope, status: { in: OPEN } },
        orderBy: { period: 'asc' },
        select: { period: true, dueDate: true, classLabel: true, totalAmount: true, lateFee: true, amountPaid: true, student: { select: studentSelect } },
      });
      const byStudent = new Map<string, { student: ReturnType<FeeReportsService['studentView']>; classLabel: string | null; months: string[]; oldestDue: string; due: number }>();
      for (const c of open) {
        const row = byStudent.get(c.student.id) ?? {
          student: this.studentView(c.student),
          classLabel: c.classLabel,
          months: [],
          oldestDue: c.dueDate.toISOString().slice(0, 10),
          due: 0,
        };
        row.months.push(c.period);
        row.classLabel = c.classLabel ?? row.classLabel;
        row.due = round2(row.due + c.totalAmount + c.lateFee - c.amountPaid);
        byStudent.set(c.student.id, row);
      }
      const rows = [...byStudent.values()].sort((a, b) => b.due - a.due);
      return { ...base, rows, totals: { students: rows.length, due: round2(rows.reduce((n, r) => n + r.due, 0)) } };
    }

    // BY_TYPE
    const month = q.month ?? todayIso().slice(0, 7);
    const challans = await this.prisma.feeInvoice.findMany({ where: { ...scope, period: month }, select: { lineItems: true, lateFee: true } });
    const byType = new Map<string, { feeType: string; challans: number; amount: number; discount: number; net: number }>();
    let lateFee = 0;
    for (const c of challans) {
      lateFee += c.lateFee;
      for (const l of ((c.lineItems ?? []) as unknown as ChallanLine[])) {
        const row = byType.get(l.name) ?? { feeType: l.name, challans: 0, amount: 0, discount: 0, net: 0 };
        row.challans++;
        row.amount = round2(row.amount + (l.amount ?? 0));
        row.discount = round2(row.discount + (l.discount ?? 0) + (l.siblingDiscount ?? 0));
        row.net = round2(row.net + (l.net ?? l.amount ?? 0));
        byType.set(l.name, row);
      }
    }
    const rows = [...byType.values()].sort((a, b) => b.net - a.net);
    return {
      ...base,
      month,
      rows,
      totals: {
        amount: round2(rows.reduce((n, r) => n + r.amount, 0)),
        discount: round2(rows.reduce((n, r) => n + r.discount, 0)),
        net: round2(rows.reduce((n, r) => n + r.net, 0)),
        lateFee: round2(lateFee),
      },
    };
  }

  // ---------- session window ----------
  /** The 12 months of the fee session that contains the academic year's start (session start month from fee settings). */
  private async session(academicYearId?: string, startMonth?: number) {
    const settings = await this.finance.getSettings();
    const sm = startMonth ?? settings.sessionStartMonth;
    const year = academicYearId
      ? await this.prisma.academicYear.findUnique({ where: { id: academicYearId }, select: { id: true, name: true, startDate: true } })
      : await this.prisma.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true, name: true, startDate: true } });
    if (!year) throw new NotFoundException('Academic year not found');
    const y = year.startDate.getUTCFullYear() - (year.startDate.getUTCMonth() + 1 < sm ? 1 : 0);
    const start = `${y}-${String(sm).padStart(2, '0')}`;
    const months = Array.from({ length: 12 }, (_, i) => addMonths(start, i));
    return { year, months, start, end: months[11], currency: settings.currencySymbol };
  }

  // ---------- 4.3 fee register ----------
  async register(q: FeeRegisterQueryDto) {
    const s = await this.session(q.academicYearId, q.sessionStartMonth);
    const where: Prisma.FeeInvoiceWhereInput = {
      status: { not: InvoiceStatus.CANCELLED },
      period: { gte: s.start, lte: s.end },
      ...(q.sectionId ? { sectionId: q.sectionId } : {}),
      ...(q.status === 'PAID' ? { status: InvoiceStatus.PAID } : {}),
      ...(q.status === 'PARTIAL' ? { status: InvoiceStatus.PARTIAL } : {}),
      ...(q.status === 'UNPAID' ? { status: { in: [InvoiceStatus.PENDING, InvoiceStatus.OVERDUE] } } : {}),
      ...(q.status === 'DISCHARGED' ? { student: { dischargedAt: { not: null } } } : {}),
      ...(q.status === 'REMITTED' ? { discountTotal: { gt: 0 } } : {}),
    };
    const rows = await this.prisma.feeInvoice.findMany({
      where,
      take: 5000,
      orderBy: [{ period: 'asc' }, { classLabel: 'asc' }, { voucherNo: 'asc' }],
      select: {
        id: true,
        voucherNo: true,
        period: true,
        dueDate: true,
        classLabel: true,
        totalAmount: true,
        lateFee: true,
        discountTotal: true,
        amountPaid: true,
        status: true,
        student: { select: studentSelect },
      },
    });
    const out = rows.map((r) => {
      const total = round2(r.totalAmount + r.lateFee);
      return {
        id: r.id,
        voucherNo: r.voucherNo,
        period: r.period,
        dueDate: r.dueDate.toISOString().slice(0, 10),
        classLabel: r.classLabel,
        student: this.studentView(r.student),
        total,
        discount: r.discountTotal,
        paid: r.amountPaid,
        balance: round2(total - r.amountPaid),
        status: STATUS_LABEL[r.status],
      };
    });
    return {
      academicYear: s.year,
      sessionStart: s.start,
      sessionEnd: s.end,
      currency: s.currency,
      rows: out,
      totals: {
        challans: out.length,
        total: round2(out.reduce((n, r) => n + r.total, 0)),
        discount: round2(out.reduce((n, r) => n + r.discount, 0)),
        paid: round2(out.reduce((n, r) => n + r.paid, 0)),
        balance: round2(out.reduce((n, r) => n + r.balance, 0)),
      },
    };
  }

  // ---------- 5.1 fee record / ledger ----------
  async ledger(q: FeeLedgerQueryDto) {
    const s = await this.session(q.academicYearId);
    const enrolled = await this.prisma.studentEnrollment.findMany({
      where: { academicYearId: s.year.id, status: 'ACTIVE', ...(q.sectionId ? { sectionId: q.sectionId } : {}) },
      select: {
        rollNumber: true,
        section: { select: { name: true, class: { select: { name: true, level: true } } } },
        student: { select: studentSelect },
      },
    });
    const term = q.search?.trim().toLowerCase();
    const digits = term?.replace(/\D/g, '');
    let people = enrolled
      .map((e) => ({ ...this.studentView(e.student), rollNumber: e.rollNumber, classLabel: `${e.section.class.name} · ${e.section.name}`, level: e.section.class.level }))
      .filter(
        (p) =>
          !term ||
          p.name.toLowerCase().includes(term) ||
          (p.rollNumber ?? '').toLowerCase() === term ||
          (!!digits && digits.length >= 4 && (p.mobile ?? '').replace(/\D/g, '').includes(digits)),
      );
    const sort = q.sort ?? 'ROLL';
    people = people.sort((a, b) =>
      sort === 'NAME'
        ? a.name.localeCompare(b.name)
        : sort === 'ADMISSION'
          ? a.admissionNo.localeCompare(b.admissionNo, undefined, { numeric: true })
          : a.level - b.level || a.classLabel.localeCompare(b.classLabel) || (a.rollNumber ?? '').localeCompare(b.rollNumber ?? '', undefined, { numeric: true }),
    );
    const ids = people.map((p) => p.id);
    const challans = ids.length
      ? await this.prisma.feeInvoice.findMany({
          where: { studentId: { in: ids }, status: { not: InvoiceStatus.CANCELLED }, period: { lte: s.end } },
          select: { studentId: true, period: true, totalAmount: true, lateFee: true, amountPaid: true, status: true },
        })
      : [];
    const rows = people.map((p, i) => {
      const mine = challans.filter((c) => c.studentId === p.id);
      const opening = round2(mine.filter((c) => c.period < s.start).reduce((n, c) => n + c.totalAmount + c.lateFee - c.amountPaid, 0));
      const months: Record<string, { total: number; paid: number; balance: number; status: string }> = {};
      for (const c of mine.filter((m) => m.period >= s.start)) {
        const total = round2(c.totalAmount + c.lateFee);
        months[c.period] = { total, paid: c.amountPaid, balance: round2(total - c.amountPaid), status: STATUS_LABEL[c.status] };
      }
      const billed = round2(Object.values(months).reduce((n, m) => n + m.total, 0));
      const paid = round2(Object.values(months).reduce((n, m) => n + m.paid, 0));
      const { level: _l, ...person } = p;
      return { sr: i + 1, ...person, openingBalance: opening, months, billed, paid, balance: round2(opening + billed - paid) };
    });
    return { academicYear: s.year, months: s.months, currency: s.currency, rows };
  }

  // ---------- 5.2 defaulter block ----------
  private async ownStudentIds(user: AuthUser) {
    if (user.role === 'STUDENT') {
      const s = await this.prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
      return s ? [s.id] : [];
    }
    if (user.role === 'PARENT') {
      const p = await this.prisma.parentProfile.findUnique({ where: { userId: user.id }, select: { children: { select: { studentId: true } } } });
      return p ? p.children.map((c) => c.studentId) : [];
    }
    return [];
  }

  /** A defaulter has a challan still unpaid `defaulterGraceDays` days after its due date. */
  async feeStatus(user: AuthUser) {
    const settings = await this.finance.getSettings();
    const ids = await this.ownStudentIds(user);
    if (!ids.length) return { blocked: false, blockEnabled: settings.blockDefaulters, graceDays: settings.defaulterGraceDays, overdueCount: 0, overdueAmount: 0, currency: settings.currencySymbol };
    const cutoff = new Date(utcDay(todayIso()).getTime() - settings.defaulterGraceDays * 86_400_000);
    const overdue = await this.prisma.feeInvoice.findMany({
      where: { studentId: { in: ids }, status: { in: OPEN }, dueDate: { lt: cutoff } },
      select: { totalAmount: true, lateFee: true, amountPaid: true },
    });
    const overdueAmount = round2(overdue.reduce((n, c) => n + c.totalAmount + c.lateFee - c.amountPaid, 0));
    return {
      blocked: settings.blockDefaulters && overdue.length > 0,
      blockEnabled: settings.blockDefaulters,
      graceDays: settings.defaulterGraceDays,
      overdueCount: overdue.length,
      overdueAmount,
      currency: settings.currencySymbol,
    };
  }
}
