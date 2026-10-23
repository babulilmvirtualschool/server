import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CashEntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CashEntriesQueryDto,
  ProfitLossQueryDto,
  RenameCashCategoryDto,
  SaveCashCategoryDto,
  SaveCashEntryDto,
  UpdateCashEntryDto,
} from './dto/cashbook.dto';

/** PDF1 6.4 income categories, created the first time the school opens Other income. */
const DEFAULT_INCOME = ['Canteen', 'Transport', 'Donation', 'Rent Income', 'Event/Function', 'Stationery', 'Books'];

const round2 = (n: number) => Math.round(n * 100) / 100;
const utcDay = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00.000Z`);
const monthOf = (d: Date) => d.toISOString().slice(0, 7);

/** Expense manager (PDF1 6.3–6.5, PDF2 Admin 7): expense / income categories, entries, profit & loss. */
@Injectable()
export class CashbookService {
  constructor(private readonly prisma: PrismaService) {}

  private async currency() {
    return (await this.prisma.feeSettings.findFirst({ select: { currencySymbol: true } }))?.currencySymbol ?? 'Rs.';
  }

  // ---------- categories ----------
  async categories(type: CashEntryType) {
    if (type === CashEntryType.INCOME && !(await this.prisma.cashCategory.count({ where: { type } }))) {
      await this.prisma.cashCategory.createMany({ data: DEFAULT_INCOME.map((name) => ({ type, name })), skipDuplicates: true });
    }
    const rows = await this.prisma.cashCategory.findMany({ where: { type }, orderBy: { name: 'asc' }, include: { _count: { select: { entries: true } } } });
    return rows.map((c) => ({ id: c.id, type: c.type, name: c.name, entries: c._count.entries }));
  }

  async createCategory(dto: SaveCashCategoryDto) {
    const name = dto.name.trim();
    const clash = await this.prisma.cashCategory.findFirst({ where: { type: dto.type, name: { equals: name, mode: 'insensitive' } } });
    if (clash) throw new ConflictException({ message: 'This category already exists.', fields: { name: 'Already exists' } });
    return this.prisma.cashCategory.create({ data: { type: dto.type, name } });
  }

  async renameCategory(id: string, dto: RenameCashCategoryDto) {
    const c = await this.prisma.cashCategory.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Category not found');
    const name = dto.name.trim();
    const clash = await this.prisma.cashCategory.findFirst({ where: { type: c.type, id: { not: id }, name: { equals: name, mode: 'insensitive' } } });
    if (clash) throw new ConflictException({ message: 'This category already exists.', fields: { name: 'Already exists' } });
    return this.prisma.cashCategory.update({ where: { id }, data: { name } });
  }

  async deleteCategory(id: string) {
    const c = await this.prisma.cashCategory.findUnique({ where: { id }, include: { _count: { select: { entries: true } } } });
    if (!c) throw new NotFoundException('Category not found');
    if (c._count.entries) throw new ConflictException('This category has entries. Move or delete them first.');
    await this.prisma.cashCategory.delete({ where: { id } });
    return { deleted: true };
  }

  // ---------- entries ----------
  private entryView(e: Prisma.CashEntryGetPayload<{ include: { category: true } }>) {
    return {
      id: e.id,
      type: e.type,
      category: { id: e.category.id, name: e.category.name },
      date: e.date.toISOString().slice(0, 10),
      amount: e.amount,
      title: e.title,
      party: e.party,
      method: e.method,
      reference: e.reference,
      note: e.note,
    };
  }

  async entries(q: CashEntriesQueryDto) {
    const s = q.search?.trim();
    const rows = await this.prisma.cashEntry.findMany({
      where: {
        type: q.type,
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
        ...(q.from || q.to ? { date: { ...(q.from ? { gte: utcDay(q.from) } : {}), ...(q.to ? { lte: utcDay(q.to) } : {}) } } : {}),
        ...(s ? { OR: [{ title: { contains: s, mode: 'insensitive' } }, { party: { contains: s, mode: 'insensitive' } }] } : {}),
      },
      include: { category: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 2000,
    });
    return { rows: rows.map((e) => this.entryView(e)), total: round2(rows.reduce((n, e) => n + e.amount, 0)), currency: await this.currency() };
  }

  private async checkCategory(categoryId: string, type: CashEntryType) {
    const c = await this.prisma.cashCategory.findUnique({ where: { id: categoryId } });
    if (!c || c.type !== type) throw new BadRequestException({ message: 'Choose a category.', fields: { categoryId: 'Choose a category' } });
  }

  async createEntry(dto: SaveCashEntryDto) {
    await this.checkCategory(dto.categoryId, dto.type);
    const e = await this.prisma.cashEntry.create({
      data: {
        type: dto.type,
        categoryId: dto.categoryId,
        date: utcDay(dto.date),
        amount: round2(dto.amount),
        title: dto.title.trim(),
        party: dto.party?.trim() || null,
        method: dto.method ?? 'CASH',
        reference: dto.reference?.trim() || null,
        note: dto.note?.trim() || null,
      },
      include: { category: true },
    });
    return this.entryView(e);
  }

  async updateEntry(id: string, dto: UpdateCashEntryDto) {
    const e = await this.prisma.cashEntry.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Entry not found');
    if (dto.type && dto.type !== e.type) throw new BadRequestException('An expense can’t become income (or the other way round).');
    if (dto.categoryId) await this.checkCategory(dto.categoryId, e.type);
    const updated = await this.prisma.cashEntry.update({
      where: { id },
      data: {
        ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
        ...(dto.date ? { date: utcDay(dto.date) } : {}),
        ...(dto.amount != null ? { amount: round2(dto.amount) } : {}),
        ...(dto.title ? { title: dto.title.trim() } : {}),
        ...(dto.party !== undefined ? { party: dto.party?.trim() || null } : {}),
        ...(dto.method ? { method: dto.method } : {}),
        ...(dto.reference !== undefined ? { reference: dto.reference?.trim() || null } : {}),
        ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
      },
      include: { category: true },
    });
    return this.entryView(updated);
  }

  async deleteEntry(id: string) {
    const e = await this.prisma.cashEntry.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Entry not found');
    await this.prisma.cashEntry.delete({ where: { id } });
    return { deleted: true };
  }

  // ---------- profit & loss ----------
  /**
   * Income = fees collected (by payment date) + other income; expenses = expense entries + staff salaries paid (by salary month).
   * With a category chosen, only that category's entries are shown (fees and salaries are left out).
   */
  async profitLoss(q: ProfitLossQueryDto) {
    const from = utcDay(q.from);
    const to = utcDay(q.to);
    if (to < from) throw new BadRequestException({ message: 'The end date is before the start date.', fields: { to: 'Before the start date' } });
    const months: string[] = [];
    for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); d <= to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
      months.push(monthOf(d));
    }
    if (months.length > 36) throw new BadRequestException('Choose at most 36 months.');
    const nextDay = new Date(to.getTime() + 86_400_000);
    const [entries, fees, salaries] = await Promise.all([
      this.prisma.cashEntry.findMany({
        where: { date: { gte: from, lt: nextDay }, ...(q.categoryId ? { categoryId: q.categoryId } : {}) },
        select: { type: true, date: true, amount: true, category: { select: { name: true } } },
      }),
      q.categoryId ? [] : this.prisma.feePayment.findMany({ where: { paidAt: { gte: from, lt: nextDay } }, select: { paidAt: true, amount: true } }),
      q.categoryId
        ? []
        : this.prisma.salaryPayment.findMany({ where: { period: { gte: months[0], lte: months[months.length - 1] }, paidAmount: { gt: 0 } }, select: { period: true, paidAmount: true } }),
    ]);
    const row = new Map(months.map((m) => [m, { month: m, fees: 0, otherIncome: 0, income: 0, salaries: 0, expenses: 0, expense: 0, net: 0 }]));
    const income = new Map<string, number>();
    const expense = new Map<string, number>();
    const add = (map: Map<string, number>, k: string, v: number) => map.set(k, round2((map.get(k) ?? 0) + v));
    for (const f of fees) {
      const r = row.get(monthOf(f.paidAt));
      if (r) r.fees = round2(r.fees + f.amount);
      add(income, 'Fee collection', f.amount);
    }
    for (const s of salaries) {
      const r = row.get(s.period);
      if (r) r.salaries = round2(r.salaries + s.paidAmount);
      add(expense, 'Staff salaries', s.paidAmount);
    }
    for (const e of entries) {
      const r = row.get(monthOf(e.date));
      if (e.type === CashEntryType.INCOME) {
        if (r) r.otherIncome = round2(r.otherIncome + e.amount);
        add(income, e.category.name, e.amount);
      } else {
        if (r) r.expenses = round2(r.expenses + e.amount);
        add(expense, e.category.name, e.amount);
      }
    }
    const rows = [...row.values()].map((r) => {
      const inc = round2(r.fees + r.otherIncome);
      const exp = round2(r.salaries + r.expenses);
      return { ...r, income: inc, expense: exp, net: round2(inc - exp) };
    });
    const totalIncome = round2(rows.reduce((n, r) => n + r.income, 0));
    const totalExpense = round2(rows.reduce((n, r) => n + r.expense, 0));
    const list = (m: Map<string, number>) => [...m.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
    return {
      from: q.from.slice(0, 10),
      to: q.to.slice(0, 10),
      currency: await this.currency(),
      months: rows,
      income: list(income),
      expenses: list(expense),
      totals: { income: totalIncome, expense: totalExpense, net: round2(totalIncome - totalExpense) },
    };
  }
}
