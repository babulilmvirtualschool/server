import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Emergency / security alert shown inside the staff portal (client, 25 Oct: "to see (All staff) inside their portal after logging"). */
export class StaffAlertDto {
  @ApiProperty({ enum: ['EMERGENCY', 'SECURITY', 'NOTICE'] })
  @IsIn(['EMERGENCY', 'SECURITY', 'NOTICE'])
  kind!: 'EMERGENCY' | 'SECURITY' | 'NOTICE';

  @ApiProperty({ enum: ['ALL_STAFF', 'TEACHERS', 'NON_TEACHING'] })
  @IsIn(['ALL_STAFF', 'TEACHERS', 'NON_TEACHING'])
  audience!: 'ALL_STAFF' | 'TEACHERS' | 'NON_TEACHING';

  @ApiPropertyOptional({ example: 'School closed today' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  body!: string;
}
