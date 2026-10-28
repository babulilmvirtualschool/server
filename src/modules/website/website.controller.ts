import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WebsiteSettingsDto } from './dto/website.dto';
import { WebsiteService } from './website.service';

/** PDF2 Admin 5 website management. */
@ApiTags('website')
@Controller()
export class WebsiteController {
  constructor(private readonly svc: WebsiteService) {}

  @Public()
  @Get('public/website')
  publicView() {
    return this.svc.publicView();
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('website-settings')
  get() {
    return this.svc.adminView();
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Put('website-settings')
  save(@Body() dto: WebsiteSettingsDto, @CurrentUser() user: AuthUser) {
    return this.svc.save(dto, user);
  }
}
