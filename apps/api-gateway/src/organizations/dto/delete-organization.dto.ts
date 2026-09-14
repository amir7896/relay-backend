import { IsString, MaxLength, MinLength } from 'class-validator';

export class DeleteOrganizationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  confirmName!: string;
}
