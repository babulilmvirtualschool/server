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
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreateBankQuestionDto,
  ListBankQuestionsDto,
  UpdateBankQuestionDto,
} from './dto/bank-question.dto';
import { QuestionBankService } from './question-bank.service';

@ApiTags('question-bank')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('question-bank')
export class QuestionBankController {
  constructor(private readonly bank: QuestionBankService) {}

  @Get()
  list(@Query() q: ListBankQuestionsDto) {
    return this.bank.list(q);
  }

  @Post()
  create(@Body() dto: CreateBankQuestionDto) {
    return this.bank.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBankQuestionDto) {
    return this.bank.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.bank.remove(id);
  }
}
