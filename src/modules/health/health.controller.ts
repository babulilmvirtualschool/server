import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async root() {
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Public()
  @Get('db')
  async db() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'reachable' };
  }
}
