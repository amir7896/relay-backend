import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RpcErrors } from '@app/common';
import { USER_PATTERNS } from '@app/contracts';
import type {
  CreateProfilePayload,
  FindUsersPayload,
  PurgeOrganizationUsersPayload,
  UpdateProfilePayload,
} from '@app/contracts';
import { runWithOrganization } from '@app/database';
import { UsersService } from './users.service';

type OrgPayload = { organizationId?: string };

@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  private withOrg<T>(payload: OrgPayload, fn: () => Promise<T>): Promise<T> {
    if (!payload.organizationId?.trim()) {
      return RpcErrors.badRequest('organizationId is required') as never;
    }
    return runWithOrganization(payload.organizationId.trim(), fn);
  }

  @MessagePattern(USER_PATTERNS.CREATE_PROFILE)
  createProfile(@Payload() payload: CreateProfilePayload & OrgPayload) {
    return this.withOrg(payload, () => this.usersService.createProfile(payload));
  }

  @MessagePattern(USER_PATTERNS.FIND_ALL)
  findAll(@Payload() payload: FindUsersPayload & OrgPayload) {
    return this.withOrg(payload, () => this.usersService.findAll(payload));
  }

  @MessagePattern(USER_PATTERNS.FIND_ONE)
  findOne(@Payload() payload: { id: string } & OrgPayload) {
    return this.withOrg(payload, () => this.usersService.findOne(payload.id));
  }

  @MessagePattern(USER_PATTERNS.FIND_BY_USER_ID)
  findByUserId(@Payload() payload: { userId: string } & OrgPayload) {
    return this.withOrg(payload, () =>
      this.usersService.findByUserId(payload.userId),
    );
  }

  @MessagePattern(USER_PATTERNS.UPDATE)
  update(@Payload() payload: UpdateProfilePayload & OrgPayload) {
    return this.withOrg(payload, () => this.usersService.update(payload));
  }

  @MessagePattern(USER_PATTERNS.REMOVE)
  remove(@Payload() payload: { userId: string } & OrgPayload) {
    return this.withOrg(payload, () =>
      this.usersService.remove(payload.userId),
    );
  }

  @MessagePattern(USER_PATTERNS.PURGE_BY_ORGANIZATION)
  purgeByOrganization(@Payload() payload: PurgeOrganizationUsersPayload) {
    if (!payload.organizationId?.trim()) {
      return RpcErrors.badRequest('organizationId is required');
    }
    return this.usersService.purgeByOrganization(payload.organizationId.trim());
  }
}
