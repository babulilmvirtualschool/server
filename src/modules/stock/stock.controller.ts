import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CategoryDto,
  CreateItemDto,
  CreateOrderDto,
  CreateTransactionDto,
  ListItemsDto,
  ListOrdersDto,
  ListTransactionsDto,
  OrderPaidDto,
  OrderStatusDto,
  StockReportDto,
  UpdateCategoryDto,
  UpdateItemDto,
} from './dto/stock.dto';
import { StockService } from './stock.service';

/** PDF2 Admin 6 Stock management (+ parents' portal orders). */
@ApiTags('stock')
@ApiBearerAuth()
@Controller()
export class StockController {
  constructor(private readonly svc: StockService) {}

  @Roles(Role.ADMIN)
  @Get('stock-categories')
  categories() {
    return this.svc.categories();
  }

  @Roles(Role.ADMIN)
  @Post('stock-categories')
  createCategory(@Body() dto: CategoryDto) {
    return this.svc.createCategory(dto);
  }

  @Roles(Role.ADMIN)
  @Patch('stock-categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.svc.updateCategory(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('stock-categories/:id')
  removeCategory(@Param('id') id: string) {
    return this.svc.removeCategory(id);
  }

  @Roles(Role.ADMIN)
  @Get('stock-items')
  items(@Query() q: ListItemsDto) {
    return this.svc.items(q);
  }

  @Roles(Role.ADMIN)
  @Post('stock-items')
  createItem(@Body() dto: CreateItemDto, @CurrentUser() user: AuthUser) {
    return this.svc.createItem(dto, user);
  }

  @Roles(Role.ADMIN)
  @Patch('stock-items/:id')
  updateItem(@Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.svc.updateItem(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('stock-items/:id')
  removeItem(@Param('id') id: string) {
    return this.svc.removeItem(id);
  }

  @Roles(Role.ADMIN)
  @Get('stock-transactions')
  transactions(@Query() q: ListTransactionsDto) {
    return this.svc.transactions(q);
  }

  @Roles(Role.ADMIN)
  @Post('stock-transactions')
  createTransaction(@Body() dto: CreateTransactionDto, @CurrentUser() user: AuthUser) {
    return this.svc.createTransaction(dto, user);
  }

  @Roles(Role.ADMIN)
  @Delete('stock-transactions/:id')
  removeTransaction(@Param('id') id: string) {
    return this.svc.removeTransaction(id);
  }

  @Roles(Role.ADMIN)
  @Get('stock-orders')
  orders(@Query() q: ListOrdersDto) {
    return this.svc.orders(q);
  }

  @Roles(Role.ADMIN, Role.PARENT)
  @Post('stock-orders')
  createOrder(@Body() dto: CreateOrderDto, @CurrentUser() user: AuthUser) {
    return this.svc.createOrder(dto, user);
  }

  @Roles(Role.ADMIN)
  @Patch('stock-orders/:id/status')
  setStatus(@Param('id') id: string, @Body() dto: OrderStatusDto, @CurrentUser() user: AuthUser) {
    return this.svc.setStatus(id, dto, user);
  }

  @Roles(Role.ADMIN)
  @Patch('stock-orders/:id/paid')
  setPaid(@Param('id') id: string, @Body() dto: OrderPaidDto) {
    return this.svc.setPaid(id, dto.paid);
  }

  @Roles(Role.ADMIN)
  @Post('stock-orders/:id/add-to-fee')
  addToFee(@Param('id') id: string) {
    return this.svc.addToFee(id);
  }

  @Roles(Role.ADMIN)
  @Get('stock-report')
  report(@Query() q: StockReportDto) {
    return this.svc.report(q);
  }

  @Roles(Role.PARENT)
  @Get('stock-shop')
  shop(@CurrentUser() user: AuthUser) {
    return this.svc.shop(user);
  }

  @Roles(Role.PARENT)
  @Get('me/stock-orders')
  myOrders(@CurrentUser() user: AuthUser) {
    return this.svc.myOrders(user);
  }

  @Roles(Role.PARENT)
  @Post('me/stock-orders/:id/cancel')
  cancelMine(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.cancelMine(id, user);
  }
}
