import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Jane' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional({ example: '+15551234567' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ example: 'Backend engineer' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/demo/image/upload/relay/profilePictures/abc',
    description: 'Cloudinary (or upload) URL for the profile photo',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  avatar?: string;

  @ApiPropertyOptional({ example: '1994-04-12' })
  @IsOptional()
  @IsDateString({}, { message: 'dateOfBirth must be an ISO date string' })
  dateOfBirth?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'When false, others will not see your last-seen timestamp',
  })
  @IsOptional()
  @IsBoolean()
  showLastSeen?: boolean;
}
