import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { isValidReactionEmoji } from '@app/common';

export class WorkspaceCustomEmojiDto {
  @IsString()
  @Matches(/^[a-z0-9_+-]{1,32}$/i)
  shortcode!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== undefined && value !== null && value !== '')
  @IsString()
  @MaxLength(64)
  @ValidateBy({
    name: 'isCustomEmojiGlyph',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' &&
        isValidReactionEmoji(value) &&
        !/^:/.test(value.trim()),
      defaultMessage: () => 'custom emoji must be a Unicode emoji',
    },
  })
  emoji?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== undefined && value !== null && value !== '')
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;
}

export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  appName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tagline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => WorkspaceCustomEmojiDto)
  customEmojis?: WorkspaceCustomEmojiDto[];
}

export class LinkPreviewDto {
  @IsUrl({ require_protocol: true })
  url!: string;
}
