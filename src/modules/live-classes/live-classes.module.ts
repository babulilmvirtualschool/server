import { Module } from '@nestjs/common';
import { LiveClassesController } from './live-classes.controller';
import { LiveClassesService } from './live-classes.service';
import { LivePollsController } from './live-polls.controller';
import { LivePollsService } from './live-polls.service';

@Module({
  controllers: [LiveClassesController, LivePollsController],
  providers: [LiveClassesService, LivePollsService],
})
export class LiveClassesModule {}
