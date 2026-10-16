import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateMessageTemplateDto, UpdateMessageTemplateDto } from './dto/message-template.dto';
import { MessagesService } from './messages.service';

@ApiTags('messages')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('message-templates')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list() {
    return this.messages.list();
  }

  @Post()
  create(@Body() dto: CreateMessageTemplateDto) {
    return this.messages.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMessageTemplateDto) {
    return this.messages.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.messages.remove(id);
  }
}
