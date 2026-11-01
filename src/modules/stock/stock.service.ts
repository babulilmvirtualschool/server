import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Campus, InvoiceStatus, Prisma, Role, StockOrderStatus, StockPaymentMode, StockTransactionType } from '@prisma/client';
import { currentCampus, runUnscoped } from '../../common/campus/campus-context';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import type { ChallanLine } from '../finance/finance.service';
import {
  CategoryDto,
  CreateItemDto,
  CreateOrderDto,
  CreateTransactionDto,
  ListItemsDto,
  ListOrdersDto,
  ListTransactionsDto,
  OrderStatusDto,
  StockReportDto,
  UpdateCategoryDto,
  UpdateItemDto,
} from './dto/stock.dto';

const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00.000Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
const name = (u?: { firstName: string; lastName: string } | null) => (u ? [u.firstName, u.lastName].filter((x) => x && x !== '.').join(' ') : '');
const OPEN: InvoiceStatus[] = [InvoiceStatus.PENDING, InvoiceStatus.PARTIAL, InvoiceStatus.OVERDUE];

const orderInclude = {
  items: { select: { id: true, itemId: true, name: true, unitPrice: true, quantity: true, amount: true } },
  placedBy: { select: { firstName: true, lastName: true, role: true, phone: true } },
  student: {
    select: {
      id: true,
      admissionNo: true,
      user: { select: { firstName: true, lastName: true } },
      enrollments: {
        where: { status: 'ACTIVE', academicYear: { isCurrent: true } },
        take: 1,
        select: { rollNumber: true, section: { select: { name: true, class: { select: { name: true } } } } },
      },
      parents: { where: { relation: 'FATHER' }, take: 1, select: { parent: { select: { user: { select: { firstName: true, lastName: true, phone: true } } } } } },
    },
  },
} satisfies Prisma.StockOrderInclude;
type OrderRow = Prisma.StockOrderGetPayload<{ include: typeof orderInclude }>;

/** PDF2 Admin 6 Stock management: categories, items, parent orders (parents' portal), transactions, stock report (client 25 Oct: paid separately or on the fee challan). */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------- categories ----------------

  async categories() {
    const rows = await this.prisma.stockCategory.findMany({ include: { _count: { select: { items: true } } }, orderBy: { name: 'asc' } });
    return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, items: r._count.items, createdAt: r.createdAt }));
  }

  async createCategory(dto: CategoryDto) {
    return this.prisma.stockCategory.create({ data: { name: dto.name.trim(), description: dto.description?.trim() || null } });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    if (!(await this.prisma.stockCategory.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Category not found');
    return this.prisma.stockCategory.update({
      where: { id },
      data: { ...(dto.name ? { name: dto.name.trim() } : {}), ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}) },
    });
  }

  async removeCategory(id: string) {
    const c = await this.prisma.stockCategory.findUnique({ where: { id }, include: { _count: { select: { items: true } } } });
    if (!c) throw new NotFoundException('Category not found');
    if (c._count.items) throw new ConflictException('This category still has items. Move or delete them first.');
    await this.prisma.stockCategory.delete({ where: { id } });
    return { id };
  }

  // ---------------- items ----------------

  private itemView(i: Prisma.StockItemGetPayload<{ include: { category: { select: { id: true; name: true } } } }>) {
    return { ...i, value: round2(i.quantity * i.price), low: i.quantity <= i.reorderLevel };
  }

  async items(q: ListItemsDto) {
    const search = q.search?.trim();
    const rows = await this.prisma.stockItem.findMany({
      where: {
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
        ...(q.isActive !== undefined ? { isActive: q.isActive } : {}),
        ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }] } : {}),
      },
      include: { category: { select: { id: true, name: true } } },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
      take: 2000,
    });
    return rows.map((r) => this.itemView(r));
  }

  private async assertCategory(id: string) {
    if (!(await this.prisma.stockCategory.findUnique({ where: { id }, select: { id: true } }))) {
      throw new BadRequestException({ message: 'Category not found.', fields: { categoryId: 'Choose a category' } });
    }
  }

  async createItem(dto: CreateItemDto, user: AuthUser) {
    await this.assertCategory(dto.categoryId);
    const opening = dto.openingQuantity ?? 0;
    const item = await this.prisma.$transaction(async (tx) => {
      const it = await tx.stockItem.create({
        data: {
          categoryId: dto.categoryId,
          name: dto.name.trim(),
          code: dto.code?.trim() || null,
          unit: dto.unit?.trim() || null,
          price: round2(dto.price),
          quantity: opening,
          reorderLevel: dto.reorderLevel ?? 0,
          description: dto.description?.trim() || null,
        },
        include: { category: { select: { id: true, name: true } } },
      });
      if (opening) {
        await tx.stockTransaction.create({
          data: { itemId: it.id, type: StockTransactionType.ADJUSTMENT, quantity: opening, date: day(ymd(new Date())), note: 'Opening stock', createdById: user.id },
        });
      }
      return it;
    });
    return this.itemView(item);
  }

  async updateItem(id: string, dto: UpdateItemDto) {
    if (!(await this.prisma.stockItem.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Item not found');
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    const it = await this.prisma.stockItem.update({
      where: { id },
      data: {
        ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.code !== undefined ? { code: dto.code.trim() || null } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit.trim() || null } : {}),
        ...(dto.price !== undefined ? { price: round2(dto.price) } : {}),
        ...(dto.reorderLevel !== undefined ? { reorderLevel: dto.reorderLevel } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: { category: { select: { id: true, name: true } } },
    });
    return this.itemView(it);
  }

  async removeItem(id: string) {
    const it = await this.prisma.stockItem.findUnique({ where: { id }, include: { _count: { select: { orderItems: true } } } });
    if (!it) throw new NotFoundException('Item not found');
    if (it._count.orderItems) throw new ConflictException('This item is on orders, so it can\'t be deleted. Make it inactive instead.');
    await this.prisma.stockItem.delete({ where: { id } });
    return { id };
  }

  // ---------------- transactions ----------------

  async transactions(q: ListTransactionsDto) {
    const rows = await this.prisma.stockTransaction.findMany({
      where: {
        ...(q.itemId ? { itemId: q.itemId } : {}),
        ...(q.categoryId ? { item: { categoryId: q.categoryId } } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(q.from || q.to ? { date: { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lte: day(q.to) } : {}) } } : {}),
      },
      include: { item: { select: { id: true, name: true, unit: true, category: { select: { name: true } } } }, createdBy: { select: { firstName: true, lastName: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 3000,
    });
    const orderIds = [...new Set(rows.map((r) => r.orderId).filter(Boolean))] as string[];
    const orders = orderIds.length ? await this.prisma.stockOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNo: true } }) : [];
    return rows.map((r) => ({
      ...r,
      date: ymd(r.date),
      itemName: r.item.name,
      categoryName: r.item.category.name,
      createdByName: name(r.createdBy),
      orderNo: orders.find((o) => o.id === r.orderId)?.orderNo ?? null,
    }));
  }

  async createTransaction(dto: CreateTransactionDto, user: AuthUser) {
    const item = await this.prisma.stockItem.findUnique({ where: { id: dto.itemId } });
    if (!item) throw new BadRequestException({ message: 'Item not found.', fields: { itemId: 'Choose an item' } });
    if (dto.quantity === 0) throw new BadRequestException({ message: 'Enter a quantity.', fields: { quantity: 'Required' } });
    if (dto.type !== 'ADJUSTMENT' && dto.quantity < 0) throw new BadRequestException({ message: 'Enter how many came in.', fields: { quantity: 'Must be more than 0' } });
    if (item.quantity + dto.quantity < 0) throw new ConflictException(`Only ${item.quantity} in stock.`);
    const unitPrice = dto.unitPrice ?? (dto.type === 'PURCHASE' ? null : item.price);
    return this.prisma.$transaction(async (tx) => {
      await tx.stockItem.update({ where: { id: item.id }, data: { quantity: { increment: dto.quantity } } });
      return tx.stockTransaction.create({
        data: {
          itemId: item.id,
          type: dto.type,
          quantity: dto.quantity,
          unitPrice: unitPrice ?? null,
          amount: unitPrice != null ? round2(unitPrice * Math.abs(dto.quantity)) : null,
          date: day(dto.date),
          note: dto.note?.trim() || null,
          createdById: user.id,
        },
      });
    });
  }

  /** Undo a hand-entered movement (order sales / returns follow the order). */
  async removeTransaction(id: string) {
    const t = await this.prisma.stockTransaction.findUnique({ where: { id }, include: { item: { select: { quantity: true } } } });
    if (!t) throw new NotFoundException('Transaction not found');
    if (t.orderId) throw new ConflictException('This movement belongs to an order — cancel the order instead.');
    if (t.item.quantity - t.quantity < 0) throw new ConflictException('Removing it would make the stock negative.');
    await this.prisma.$transaction([
      this.prisma.stockItem.update({ where: { id: t.itemId }, data: { quantity: { decrement: t.quantity } } }),
      this.prisma.stockTransaction.delete({ where: { id } }),
    ]);
    return { id };
  }

  // ---------------- orders ----------------

  private async orderViews(rows: OrderRow[]) {
    const invIds = [...new Set(rows.map((r) => r.feeInvoiceId).filter(Boolean))] as string[];
    const invoices = invIds.length
      ? await this.prisma.feeInvoice.findMany({ where: { id: { in: invIds } }, select: { id: true, voucherNo: true, period: true, status: true } })
      : [];
    return rows.map((r) => {
      const inv = invoices.find((i) => i.id === r.feeInvoiceId) ?? null;
      const enr = r.student.enrollments[0];
      const father = r.student.parents[0]?.parent.user;
      return {
        id: r.id,
        orderNo: r.orderNo,
        status: r.status,
        paymentMode: r.paymentMode,
        /** WITH_FEE orders count as paid once their challan is paid. */
        paid: r.paymentMode === StockPaymentMode.WITH_FEE ? inv?.status === InvoiceStatus.PAID : r.paid,
        paidAt: r.paidAt,
        total: r.total,
        note: r.note,
        adminNote: r.adminNote,
        deliveredAt: r.deliveredAt,
        createdAt: r.createdAt,
        items: r.items,
        challan: inv,
        placedBy: r.placedBy ? { name: name(r.placedBy), role: r.placedBy.role, phone: r.placedBy.phone } : null,
        student: {
          id: r.student.id,
          name: name(r.student.user),
          admissionNo: r.student.admissionNo,
          classLabel: enr ? `${enr.section.class.name} · ${enr.section.name}` : null,
          rollNumber: enr?.rollNumber ?? null,
          fatherName: name(father),
          fatherPhone: father?.phone ?? null,
        },
      };
    });
  }

  async orders(q: ListOrdersDto, extra: Prisma.StockOrderWhereInput = {}) {
    const search = q.search?.trim();
    const rows = await this.prisma.stockOrder.findMany({
      where: {
        ...extra,
        ...(q.status ? { status: q.status } : {}),
        ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lt: new Date(day(q.to).getTime() + 86_400_000) } : {}) } } : {}),
        ...(search
          ? {
              OR: [
                { orderNo: { contains: search, mode: 'insensitive' } },
                { student: { admissionNo: { contains: search, mode: 'insensitive' } } },
                { student: { user: { OR: [{ firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }] } } },
              ],
            }
          : {}),
      },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
    return this.orderViews(rows);
  }

  private async nextOrderNo(tx: Prisma.TransactionClient) {
    const prefix = `${(currentCampus() ?? Campus.ONLINE) === Campus.PHYSICAL ? 'PH' : 'ON'}-SO-`;
    const last = await runUnscoped(() =>
      tx.stockOrder.findFirst({ where: { orderNo: { startsWith: prefix } }, orderBy: { orderNo: 'desc' }, select: { orderNo: true } }),
    );
    return `${prefix}${String((last ? parseInt(last.orderNo.slice(prefix.length), 10) || 0 : 0) + 1).padStart(6, '0')}`;
  }

  private async childIds(user: AuthUser) {
    const parent = await this.prisma.parentProfile.findUnique({ where: { userId: user.id }, select: { children: { select: { studentId: true } } } });
    if (!parent) throw new ForbiddenException();
    return parent.children.map((c) => c.studentId);
  }

  async createOrder(dto: CreateOrderDto, user: AuthUser) {
    if (user.role === Role.PARENT && !(await this.childIds(user)).includes(dto.studentId)) {
      throw new ForbiddenException('You can only order for your own children.');
    }
    if (user.role === Role.ADMIN && !(await this.prisma.studentProfile.findUnique({ where: { id: dto.studentId }, select: { id: true } }))) {
      throw new BadRequestException({ message: 'Student not found.', fields: { studentId: 'Choose a student' } });
    }
    const ids = dto.items.map((i) => i.itemId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each item can be listed once.');
    const items = await this.prisma.stockItem.findMany({ where: { id: { in: ids }, isActive: true } });
    const lines = dto.items.map((l) => {
      const it = items.find((i) => i.id === l.itemId);
      if (!it) throw new BadRequestException('An item is no longer available.');
      if (l.quantity > it.quantity) throw new ConflictException(`Only ${it.quantity} ${it.name} in stock.`);
      return { itemId: it.id, name: it.name, unitPrice: it.price, quantity: l.quantity, amount: round2(it.price * l.quantity) };
    });
    for (let attempt = 0; ; attempt++) {
      try {
        const row = await this.prisma.$transaction(async (tx) =>
          tx.stockOrder.create({
            data: {
              orderNo: await this.nextOrderNo(tx),
              studentId: dto.studentId,
              placedById: user.id,
              status: user.role === Role.ADMIN ? StockOrderStatus.APPROVED : StockOrderStatus.PENDING,
              paymentMode: dto.paymentMode,
              total: round2(lines.reduce((n, l) => n + l.amount, 0)),
              note: dto.note?.trim() || null,
              items: { create: lines },
            },
            include: orderInclude,
          }),
        );
        return (await this.orderViews([row]))[0];
      } catch (e) {
        if (attempt < 2 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
  }

  private async getOrder(id: string) {
    const o = await this.prisma.stockOrder.findUnique({ where: { id }, include: orderInclude });
    if (!o) throw new NotFoundException('Order not found');
    return o;
  }

  /** Approve, deliver (stock goes out as sales; cash on delivery counts as paid) or cancel (delivered stock comes back). */
  async setStatus(id: string, dto: OrderStatusDto, user: AuthUser) {
    const o = await this.getOrder(id);
    if (o.status === StockOrderStatus.CANCELLED) throw new ConflictException('This order is cancelled.');
    if (o.status === dto.status) throw new ConflictException(`The order is already ${dto.status.toLowerCase()}.`);
    if (dto.status === 'APPROVED' && o.status !== StockOrderStatus.PENDING) throw new ConflictException('Only a pending order can be approved.');
    if (dto.status === 'CANCELLED' && o.feeInvoiceId) throw new ConflictException('This order is on a fee challan — regenerate or delete that challan first.');
    const today = day(ymd(new Date()));
    await this.prisma.$transaction(async (tx) => {
      if (dto.status === 'DELIVERED') {
        for (const l of o.items) {
          const it = await tx.stockItem.findUnique({ where: { id: l.itemId }, select: { quantity: true, name: true } });
          if (!it || it.quantity < l.quantity) throw new ConflictException(`Only ${it?.quantity ?? 0} ${l.name} in stock.`);
          await tx.stockItem.update({ where: { id: l.itemId }, data: { quantity: { decrement: l.quantity } } });
          await tx.stockTransaction.create({
            data: { itemId: l.itemId, type: StockTransactionType.SALE, quantity: -l.quantity, unitPrice: l.unitPrice, amount: l.amount, date: today, orderId: o.id, note: `Order ${o.orderNo}`, createdById: user.id },
          });
        }
      }
      if (dto.status === 'CANCELLED' && o.status === StockOrderStatus.DELIVERED) {
        for (const l of o.items) {
          await tx.stockItem.update({ where: { id: l.itemId }, data: { quantity: { increment: l.quantity } } });
          await tx.stockTransaction.create({
            data: { itemId: l.itemId, type: StockTransactionType.RETURN, quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, date: today, orderId: o.id, note: `Order ${o.orderNo} cancelled`, createdById: user.id },
          });
        }
      }
      const codPaid = dto.status === 'DELIVERED' && o.paymentMode === StockPaymentMode.CASH_ON_DELIVERY && !o.paid;
      await tx.stockOrder.update({
        where: { id },
        data: {
          status: dto.status,
          ...(dto.adminNote !== undefined ? { adminNote: dto.adminNote.trim() || null } : {}),
          ...(dto.status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
          ...(codPaid ? { paid: true, paidAt: new Date() } : {}),
          ...(dto.status === 'CANCELLED' ? { paid: false, paidAt: null } : {}),
        },
      });
    });
    return (await this.orderViews([await this.getOrder(id)]))[0];
  }

  async setPaid(id: string, paid: boolean) {
    const o = await this.getOrder(id);
    if (o.paymentMode === StockPaymentMode.WITH_FEE) throw new ConflictException('This order is paid with the fee challan.');
    if (o.status === StockOrderStatus.CANCELLED) throw new ConflictException('This order is cancelled.');
    await this.prisma.stockOrder.update({ where: { id }, data: { paid, paidAt: paid ? new Date() : null } });
    return (await this.orderViews([await this.getOrder(id)]))[0];
  }

  /** "With fee": the order is added to the student's latest unpaid challan as its own line with the item details. */
  async addToFee(id: string) {
    const o = await this.getOrder(id);
    if (o.paymentMode !== StockPaymentMode.WITH_FEE) throw new ConflictException('Only orders to be paid with the fee go on the challan.');
    if (o.status === StockOrderStatus.CANCELLED) throw new ConflictException('This order is cancelled.');
    if (o.feeInvoiceId) throw new ConflictException('This order is already on a challan.');
    const inv = await this.prisma.feeInvoice.findFirst({ where: { studentId: o.studentId, status: { in: OPEN } }, orderBy: { period: 'desc' } });
    if (!inv) throw new ConflictException('This student has no unpaid challan. Generate the month\'s challan first.');
    const line: ChallanLine = {
      feeTypeId: '',
      name: 'Stock items',
      frequency: 'ONE_TIME',
      amount: o.total,
      discount: 0,
      discountIds: [],
      siblingDiscount: 0,
      net: o.total,
      stockOrderId: o.id,
      details: `${o.orderNo}: ${o.items.map((i) => `${i.name} x ${i.quantity}`).join(', ')}`,
    };
    await this.prisma.$transaction([
      this.prisma.feeInvoice.update({
        where: { id: inv.id },
        data: {
          lineItems: [...((inv.lineItems ?? []) as unknown as ChallanLine[]), line] as unknown as Prisma.InputJsonValue,
          totalAmount: round2(inv.totalAmount + o.total),
          ...(inv.status !== InvoiceStatus.OVERDUE ? { status: inv.amountPaid > 0 ? InvoiceStatus.PARTIAL : InvoiceStatus.PENDING } : {}),
        },
      }),
      this.prisma.stockOrder.update({ where: { id }, data: { feeInvoiceId: inv.id } }),
    ]);
    return (await this.orderViews([await this.getOrder(id)]))[0];
  }

  // ---------------- parents' portal ----------------

  async shop(user: AuthUser) {
    const [categories, parent] = await Promise.all([
      this.prisma.stockCategory.findMany({
        where: { items: { some: { isActive: true } } },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          items: { where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, unit: true, price: true, quantity: true, description: true } },
        },
      }),
      this.prisma.parentProfile.findUnique({
        where: { userId: user.id },
        select: { children: { select: { student: { select: { id: true, user: { select: { firstName: true, lastName: true } } } } } } },
      }),
    ]);
    return {
      categories: categories.map((c) => ({ ...c, items: c.items.map(({ quantity, ...i }) => ({ ...i, available: quantity })) })),
      children: (parent?.children ?? []).map((c) => ({ id: c.student.id, name: name(c.student.user) })),
    };
  }

  async myOrders(user: AuthUser) {
    return this.orders({}, { studentId: { in: await this.childIds(user) } });
  }

  async cancelMine(id: string, user: AuthUser) {
    const o = await this.getOrder(id);
    if (!(await this.childIds(user)).includes(o.studentId)) throw new NotFoundException('Order not found');
    if (o.status !== StockOrderStatus.PENDING) throw new ConflictException('Only a pending order can be cancelled. Please contact the school office.');
    await this.prisma.stockOrder.update({ where: { id }, data: { status: StockOrderStatus.CANCELLED } });
    return (await this.orderViews([await this.getOrder(id)]))[0];
  }

  // ---------------- stock report ----------------

  /** Per item: opening, purchased, sold, returned, adjusted, closing (quantities in the date range), stock value at today's price. */
  async report(q: StockReportDto) {
    const from = q.from ? day(q.from) : null;
    const to = q.to ? day(q.to) : null;
    const items = await this.prisma.stockItem.findMany({
      where: q.categoryId ? { categoryId: q.categoryId } : {},
      include: { category: { select: { name: true } }, transactions: { select: { type: true, quantity: true, amount: true, date: true } } },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    });
    const rows = items.map((it) => {
      const after = (d: Date | null, strict: boolean) => (d ? it.transactions.filter((t) => (strict ? t.date > d : t.date >= d)).reduce((n, t) => n + t.quantity, 0) : 0);
      const opening = from ? it.quantity - after(from, false) : 0;
      const closing = to ? it.quantity - after(to, true) : it.quantity;
      const inRange = it.transactions.filter((t) => (!from || t.date >= from) && (!to || t.date <= to));
      const sum = (type: StockTransactionType) => inRange.filter((t) => t.type === type).reduce((n, t) => n + t.quantity, 0);
      const sales = inRange.filter((t) => t.type === StockTransactionType.SALE).reduce((n, t) => n + (t.amount ?? 0), 0);
      const returnsValue = inRange.filter((t) => t.type === StockTransactionType.RETURN).reduce((n, t) => n + (t.amount ?? 0), 0);
      const purchaseCost = inRange.filter((t) => t.type === StockTransactionType.PURCHASE).reduce((n, t) => n + (t.amount ?? 0), 0);
      return {
        itemId: it.id,
        name: it.name,
        code: it.code,
        unit: it.unit,
        category: it.category.name,
        price: it.price,
        isActive: it.isActive,
        reorderLevel: it.reorderLevel,
        opening,
        purchased: sum(StockTransactionType.PURCHASE),
        sold: -sum(StockTransactionType.SALE),
        returned: sum(StockTransactionType.RETURN),
        adjusted: sum(StockTransactionType.ADJUSTMENT),
        closing,
        value: round2(closing * it.price),
        salesAmount: round2(sales - returnsValue),
        purchaseCost: round2(purchaseCost),
        low: it.quantity <= it.reorderLevel,
      };
    });
    const total = (k: 'purchased' | 'sold' | 'value' | 'salesAmount' | 'purchaseCost') => round2(rows.reduce((n, r) => n + r[k], 0));
    return {
      from: q.from ?? null,
      to: q.to ?? null,
      rows,
      totals: { items: rows.length, purchased: total('purchased'), sold: total('sold'), value: total('value'), salesAmount: total('salesAmount'), purchaseCost: total('purchaseCost'), low: rows.filter((r) => r.low && r.isActive).length },
    };
  }
}
