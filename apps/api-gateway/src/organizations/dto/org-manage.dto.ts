import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateOrganizationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;
}

export class SetOrgMemberRoleDto {
  @IsIn(['admin', 'member'])
  role!: 'admin' | 'member';
}

export class TransferOwnershipDto {
  @IsString()
  @MinLength(1)
  userId!: string;
}
