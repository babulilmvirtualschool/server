import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { MediaService } from './media.service';
import { FinalizeUploadDto, PresignUploadDto } from './dto/media.dto';

@ApiTags('media')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(private readonly svc: MediaService) {}

  @Post('presign-upload')
  presignUpload(
    @CurrentUser() user: AuthUser,
    @Body() dto: PresignUploadDto,
  ) {
    return this.svc.presignUpload(user, dto);
  }

  @Post('finalize')
  finalize(
    @CurrentUser() user: AuthUser,
    @Body() dto: FinalizeUploadDto,
  ) {
    return this.svc.finalize(user, dto);
  }

  @Get('presign-download')
  presignDownload(@Query('key') key: string) {
    return this.svc.presignDownload(key);
  }
}
