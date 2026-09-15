import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsJWT,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'jane.doe@example.com' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'Str0ng!Pass' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).+$/, {
    message:
      'password must include upper, lower, number, and special characters',
  })
  password!: string;
}

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class CreateInviteDto {
  @ApiPropertyOptional({
    description: 'Optional email-bound invite (single use)',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: 90 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  expiresInDays?: number;

  @ApiPropertyOptional({
    default: 25,
    description: 'Ignored for email-bound invites (always 1)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  maxUses?: number;

  @ApiPropertyOptional({
    enum: ['member', 'guest'],
    default: 'member',
    description: 'Guest invites do not consume billed seats',
  })
  @IsOptional()
  @IsIn(['member', 'guest'])
  role?: 'member' | 'guest';
}

export class RevokeInviteDto {
  @ApiProperty()
  @IsUUID()
  inviteId!: string;
}

export class Verify2faLoginDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @IsJWT({ message: 'tempToken must be a valid JWT' })
  tempToken!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit authenticator code' })
  code!: string;
}

export class Confirm2faDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit authenticator code' })
  code!: string;
}

export class Disable2faDto {
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiPropertyOptional({ example: '123456' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit authenticator code' })
  code?: string;
}

export class SessionRefreshTokenDto {
  @ApiPropertyOptional({
    description: 'Current refresh token used to mark the active session',
  })
  @IsOptional()
  @IsString()
  @IsJWT({ message: 'refreshToken must be a valid JWT' })
  refreshToken?: string;
}
