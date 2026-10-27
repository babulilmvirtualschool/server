import { Module } from '@nestjs/common';
import { QuestionBankController } from './question-bank.controller';
import { QuestionBankService } from './question-bank.service';
import { QuestionPapersController } from './question-papers.controller';
import { QuestionPapersService } from './question-papers.service';

@Module({
  controllers: [QuestionBankController, QuestionPapersController],
  providers: [QuestionBankService, QuestionPapersService],
})
export class QuestionBankModule {}
