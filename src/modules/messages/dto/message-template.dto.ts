import { ApiProperty, PartialType } from '@nestjs/swagger';
import { MessageTemplateKind } from '@prisma/client';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMessageTemplateDto {
  @ApiProperty({ enum: MessageTemplateKind, description: 'Where the template is offered (absent / late / leave notice, % alert, general notice).' })
  @IsEnum(MessageTemplateKind)
  kind!: MessageTemplateKind;

  @ApiProperty({ example: 'Absent notice (Urdu)' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ description: 'Placeholders: {student} {class} {date} {percent} {period} {absent} {school}' })
  @IsString()
  @MinLength(1)
  @MaxLength(1500)
  body!: string;
}

export class UpdateMessageTemplateDto extends PartialType(CreateMessageTemplateDto) {}
