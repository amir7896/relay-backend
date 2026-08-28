import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

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
}

export class LinkPreviewDto {
  @IsUrl({ require_protocol: true })
  url!: string;
}
