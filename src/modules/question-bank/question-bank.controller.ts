import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  BulkBankQuestionsDto,
  CreateBankQuestionDto,
  ListBankQuestionsDto,
  UpdateBankQuestionDto,
} from './dto/bank-question.dto';
import { QuestionBankService } from './question-bank.service';

/** PDF1 11.1 Chapter-wise question repository; PDF2 Teacher 4 — teachers use it for the subjects they teach. */
@ApiTags('question-bank')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.TEACHER)
@Controller('question-bank')
export class QuestionBankController {
  constructor(private readonly bank: QuestionBankService) {}

  @Get()
  list(@Query() q: ListBankQuestionsDto, @CurrentUser() user: AuthUser) {
    return this.bank.list(q, user);
  }

  @Get('subjects')
  subjects(@CurrentUser() user: AuthUser) {
    return this.bank.subjects(user);
  }

  @Post()
  create(@Body() dto: CreateBankQuestionDto, @CurrentUser() user: AuthUser) {
    return this.bank.create(dto, user);
  }

  @Post('bulk')
  bulk(@Body() dto: BulkBankQuestionsDto, @CurrentUser() user: AuthUser) {
    return this.bank.bulk(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBankQuestionDto, @CurrentUser() user: AuthUser) {
    return this.bank.update(id, dto, user);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.bank.duplicate(id, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.bank.remove(id, user);
  }
}
