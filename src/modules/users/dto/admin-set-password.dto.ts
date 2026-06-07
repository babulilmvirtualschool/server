import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AdminSetPasswordDto {
  @ApiProperty({ minLength: 8, description: 'New password for the user account' })
  @IsString()
  @MinLength(8)
  password!: string;
}
