import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMessageTemplateDto, UpdateMessageTemplateDto } from './dto/message-template.dto';

/** WhatsApp message templates of the school (campus-scoped by the middleware). */
@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.messageTemplate.findMany({ orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] });
  }

  create(dto: CreateMessageTemplateDto) {
    return this.prisma.messageTemplate.create({
      data: { kind: dto.kind, name: dto.name.trim(), body: dto.body.trim() },
    });
  }

  async update(id: string, dto: UpdateMessageTemplateDto) {
    await this.ensure(id);
    return this.prisma.messageTemplate.update({
      where: { id },
      data: {
        ...(dto.kind ? { kind: dto.kind } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.body !== undefined ? { body: dto.body.trim() } : {}),
      },
    });
  }

  async remove(id: string) {
    await this.ensure(id);
    await this.prisma.messageTemplate.delete({ where: { id } });
    return { success: true as const };
  }

  private async ensure(id: string) {
    const t = await this.prisma.messageTemplate.findUnique({ where: { id }, select: { id: true } });
    if (!t) throw new NotFoundException('Template not found');
  }
}
