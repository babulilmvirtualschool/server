import { Module } from '@nestjs/common';
import { ConductController } from './conduct.controller';
import { ConductService } from './conduct.service';

@Module({
  controllers: [ConductController],
  providers: [ConductService],
})
export class ConductModule {}
