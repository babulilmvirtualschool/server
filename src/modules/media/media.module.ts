import { Global, Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { R2Service } from './r2.service';
import { MediaCleanupTask } from './media-cleanup.task';

@Global()
@Module({
  controllers: [MediaController],
  providers: [MediaService, R2Service, MediaCleanupTask],
  exports: [MediaService, R2Service],
})
export class MediaModule {}
