import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateOrganizationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;
}

export class SetOrgMemberRoleDto {
  @IsIn(['admin', 'member', 'guest'])
  role!: 'admin' | 'member' | 'guest';
}

export class TransferOwnershipDto {
  @IsString()
  @MinLength(1)
  userId!: string;
}

export class UpdateOrgBillingDto {
  @IsOptional()
  @IsIn(['free', 'pro', 'enterprise'])
  plan?: 'free' | 'pro' | 'enterprise';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxSeats?: number;
}

export class CreateBillingCheckoutDto {
  @IsIn(['pro', 'enterprise'])
  plan!: 'pro' | 'enterprise';
}

export class UpdateOrgSsoDto {
  @IsBoolean()
  ssoEnabled!: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(['oidc', 'saml'])
  ssoProvider?: 'oidc' | 'saml' | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  ssoIssuerUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(255)
  ssoClientId?: string | null;

  /** Write-only; leave empty to keep the existing secret. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsString()
  @MaxLength(500)
  ssoClientSecret?: string | null;

  /** SAML IdP HTTP-Redirect SSO URL */
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  ssoIdpSsoUrl?: string | null;

  /** SAML IdP X.509 certificate (PEM). Write-only. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsString()
  @MaxLength(16000)
  ssoIdpCertificate?: string | null;
}
