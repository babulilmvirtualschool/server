import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreatePaperPatternDto,
  CreateQuestionPaperDto,
  GeneratePaperDto,
  ListQuestionPapersDto,
  SetPaperItemsDto,
  UpdatePaperPatternDto,
  UpdateQuestionPaperDto,
} from './dto/question-paper.dto';
import { QuestionPapersService } from './question-papers.service';

/** PDF1 12.1–12.3 Paper generator (PDF2 Teacher 5: teachers too). */
@ApiTags('paper-generator')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.TEACHER)
@Controller()
export class QuestionPapersController {
  constructor(private readonly papers: QuestionPapersService) {}

  @Get('paper-patterns')
  listPatterns(@Query('subjectId') subjectId: string | undefined, @CurrentUser() user: AuthUser) {
    return this.papers.listPatterns(subjectId, user);
  }

  @Post('paper-patterns')
  createPattern(@Body() dto: CreatePaperPatternDto, @CurrentUser() user: AuthUser) {
    return this.papers.createPattern(dto, user);
  }

  @Patch('paper-patterns/:id')
  updatePattern(@Param('id') id: string, @Body() dto: UpdatePaperPatternDto, @CurrentUser() user: AuthUser) {
    return this.papers.updatePattern(id, dto, user);
  }

  @Delete('paper-patterns/:id')
  deletePattern(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.papers.deletePattern(id, user);
  }

  @Get('question-papers')
  list(@Query() q: ListQuestionPapersDto, @CurrentUser() user: AuthUser) {
    return this.papers.listPapers(q, user);
  }

  @Post('question-papers')
  create(@Body() dto: CreateQuestionPaperDto, @CurrentUser() user: AuthUser) {
    return this.papers.createPaper(dto, user);
  }

  @Get('question-papers/:id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.papers.getPaper(id, user);
  }

  @Patch('question-papers/:id')
  update(@Param('id') id: string, @Body() dto: UpdateQuestionPaperDto, @CurrentUser() user: AuthUser) {
    return this.papers.updatePaper(id, dto, user);
  }

  @Delete('question-papers/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.papers.deletePaper(id, user);
  }

  @Put('question-papers/:id/items')
  setItems(@Param('id') id: string, @Body() dto: SetPaperItemsDto, @CurrentUser() user: AuthUser) {
    return this.papers.setItems(id, dto, user);
  }

  @Post('question-papers/:id/generate')
  generate(@Param('id') id: string, @Body() dto: GeneratePaperDto, @CurrentUser() user: AuthUser) {
    return this.papers.generate(id, dto, user);
  }

  /** Date sheet "Paper" button: the question paper of this exam paper (made from the exam details the first time). */
  @Post('exam-papers/:paperId/question-paper')
  forExamPaper(@Param('paperId') paperId: string, @CurrentUser() user: AuthUser) {
    return this.papers.forExamPaper(paperId, user);
  }
}
