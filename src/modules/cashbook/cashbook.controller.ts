import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CashbookService } from './cashbook.service';
import {
  CashCategoriesQueryDto,
  CashEntriesQueryDto,
  ProfitLossQueryDto,
  RenameCashCategoryDto,
  SaveCashCategoryDto,
  SaveCashEntryDto,
  UpdateCashEntryDto,
} from './dto/cashbook.dto';

/** Expense manager (admin): categories, expenses, other income, profit & loss. */
@ApiTags('expenses')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller()
export class CashbookController {
  constructor(private readonly svc: CashbookService) {}

  @Get('cash-categories')
  categories(@Query() q: CashCategoriesQueryDto) {
    return this.svc.categories(q.type);
  }

  @Post('cash-categories')
  createCategory(@Body() dto: SaveCashCategoryDto) {
    return this.svc.createCategory(dto);
  }

  @Patch('cash-categories/:id')
  renameCategory(@Param('id') id: string, @Body() dto: RenameCashCategoryDto) {
    return this.svc.renameCategory(id, dto);
  }

  @Delete('cash-categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.svc.deleteCategory(id);
  }

  @Get('cash-entries')
  entries(@Query() q: CashEntriesQueryDto) {
    return this.svc.entries(q);
  }

  @Post('cash-entries')
  createEntry(@Body() dto: SaveCashEntryDto) {
    return this.svc.createEntry(dto);
  }

  @Patch('cash-entries/:id')
  updateEntry(@Param('id') id: string, @Body() dto: UpdateCashEntryDto) {
    return this.svc.updateEntry(id, dto);
  }

  @Delete('cash-entries/:id')
  deleteEntry(@Param('id') id: string) {
    return this.svc.deleteEntry(id);
  }

  @Get('profit-loss')
  profitLoss(@Query() q: ProfitLossQueryDto) {
    return this.svc.profitLoss(q);
  }
}
