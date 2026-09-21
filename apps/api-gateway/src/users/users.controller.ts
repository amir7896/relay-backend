import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { FileInterceptor } from '@nestjs/platform-express';
import { RpcException } from '@nestjs/microservices';
import { memoryStorage } from 'multer';
import {
  AuthenticatedUser,
  BadRequestAppException,
  CurrentUser,
  PaginationQueryDto,
  ParseUuidPipe,
  Roles,
  USER_SUCCESS_MESSAGES,
  UserRole,
  type PaginatedResult,
} from '@app/common';
import { AUTH_PATTERNS, USER_PATTERNS } from '@app/contracts';
import type { OrgMemberView, UserProfileView } from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { StorageService } from '../storage/storage.service';
import { getGatewayTenant } from '../organizations/tenant-context';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  DeleteUserDocs,
  GetMyProfileDocs,
  GetUserDocs,
  ListDirectoryDocs,
  ListUsersDocs,
  UpdateMyProfileDocs,
  UpdateUserDocs,
  UploadMyAvatarDocs,
  UsersDocs,
} from './swagger/users.swagger';

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
const AVATAR_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

type UploadedAvatar = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

function isNotFoundRpc(error: unknown): boolean {
  const probe = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    if (record.statusCode === 404 || record.status === 404) return true;
    if (typeof record.message === 'string' && /not found/i.test(record.message)) {
      return true;
    }
    if (typeof record.message === 'object' && record.message !== null) {
      return probe(record.message);
    }
    if (typeof record.error === 'object' && record.error !== null) {
      return probe(record.error);
    }
    return false;
  };

  if (error instanceof RpcException) {
    return probe(error.getError());
  }
  return probe(error);
}

function namesFromEmail(email: string): { firstName: string; lastName: string } {
  const local = email.split('@')[0] || 'User';
  const parts = local.split(/[._-]+/).filter(Boolean);
  return {
    firstName: parts[0] || 'User',
    lastName: parts.slice(1).join(' ') || 'Account',
  };
}

@UsersDocs()
@Controller('users')
export class UsersController {
  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly storage: StorageService,
  ) {}

  /** Heal missing per-org profiles (workspace switch / legacy joins). */
  private async ensureMyProfile(
    user: AuthenticatedUser,
  ): Promise<UserProfileView> {
    try {
      return await this.proxy.sendUser<UserProfileView>(
        USER_PATTERNS.FIND_BY_USER_ID,
        { userId: user.id },
      );
    } catch (error) {
      if (!isNotFoundRpc(error)) throw error;
      const names = namesFromEmail(user.email);
      return this.proxy.sendUser<UserProfileView>(USER_PATTERNS.CREATE_PROFILE, {
        userId: user.id,
        email: user.email,
        firstName: names.firstName,
        lastName: names.lastName,
      });
    }
  }

  private async ensureProfileForMember(input: {
    userId: string;
    email: string;
  }): Promise<void> {
    try {
      await this.proxy.sendUser(USER_PATTERNS.FIND_BY_USER_ID, {
        userId: input.userId,
      });
    } catch (error) {
      if (!isNotFoundRpc(error)) throw error;
      const names = namesFromEmail(input.email);
      await this.proxy.sendUser(USER_PATTERNS.CREATE_PROFILE, {
        userId: input.userId,
        email: input.email,
        firstName: names.firstName,
        lastName: names.lastName,
      });
    }
  }

  /** Ensure every workspace member has a profile row so DM / directory work. */
  private async syncDirectoryProfiles(actor: AuthenticatedUser): Promise<void> {
    const tenant = getGatewayTenant();
    if (!tenant?.id) return;

    try {
      const members = await this.proxy.sendAuth<PaginatedResult<OrgMemberView>>(
        AUTH_PATTERNS.LIST_ORG_MEMBERS,
        {
          organizationId: tenant.id,
          requestedByUserId: actor.id,
          page: 1,
          limit: 100,
        },
        { skipTenant: true },
      );

      await Promise.all(
        (members.items ?? []).map(async (member) => {
          const email = member.email?.trim() || '';
          if (!email) return;
          try {
            await this.ensureProfileForMember({
              userId: member.userId,
              email,
            });
          } catch {
            // Best-effort — directory still returns whatever profiles exist.
          }
        }),
      );
    } catch {
      // Member list unavailable — fall through to existing profiles.
    }
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(30_000)
  @ListUsersDocs()
  async findAll(@Query() query: PaginationQueryDto) {
    const data = await this.proxy.sendUser(USER_PATTERNS.FIND_ALL, query);
    return { message: USER_SUCCESS_MESSAGES.USERS_FETCHED, data };
  }

  @Get('me')
  @GetMyProfileDocs()
  async me(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.ensureMyProfile(user);
    return { message: USER_SUCCESS_MESSAGES.PROFILE_FETCHED, data };
  }

  @Get('directory')
  @ListDirectoryDocs()
  async directory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    await this.ensureMyProfile(user);
    await this.syncDirectoryProfiles(user);
    const data = await this.proxy.sendUser(USER_PATTERNS.FIND_ALL, query);
    return { message: USER_SUCCESS_MESSAGES.USERS_FETCHED, data };
  }

  @Get('lookup/:userId')
  async lookupByUserId(@Param('userId', ParseUuidPipe) userId: string) {
    const data = await this.proxy.sendUser<UserProfileView>(
      USER_PATTERNS.FIND_BY_USER_ID,
      { userId },
    );
    return { message: USER_SUCCESS_MESSAGES.PROFILE_FETCHED, data };
  }

  @Patch('me')
  @UpdateMyProfileDocs()
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    let previousAvatar: string | null = null;
    const current = await this.ensureMyProfile(user);
    if (dto.avatar !== undefined) {
      previousAvatar = current.avatar;
    }

    const data = await this.proxy.sendUser<UserProfileView>(
      USER_PATTERNS.UPDATE,
      {
        userId: user.id,
        ...dto,
      },
    );

    if (
      previousAvatar &&
      (!data.avatar || data.avatar !== previousAvatar)
    ) {
      void this.storage.deleteByUrl(previousAvatar);
    }

    return { message: USER_SUCCESS_MESSAGES.USER_UPDATED, data };
  }

  @Post('me/avatar')
  @HttpCode(HttpStatus.OK)
  @UploadMyAvatarDocs()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_AVATAR_BYTES },
    }),
  )
  async uploadAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: UploadedAvatar,
  ) {
    if (!file) {
      throw new BadRequestAppException('File is required');
    }
    if (!AVATAR_MIMES.has(file.mimetype)) {
      throw new BadRequestException(
        'Only JPEG, PNG, GIF, or WebP images are allowed',
      );
    }
    if (file.size > MAX_AVATAR_BYTES) {
      throw new BadRequestAppException('Image must be 10MB or smaller');
    }

    const current = await this.ensureMyProfile(user);

    const uploaded = await this.storage.upload({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      userName: user.email,
      purpose: 'avatar',
    });

    const data = await this.proxy.sendUser<UserProfileView>(
      USER_PATTERNS.UPDATE,
      {
        userId: user.id,
        avatar: uploaded.url,
      },
    );

    if (current.avatar && current.avatar !== uploaded.url) {
      void this.storage.deleteByUrl(current.avatar);
    }

    return {
      message: USER_SUCCESS_MESSAGES.AVATAR_UPDATED,
      data: {
        ...data,
        upload: {
          url: uploaded.url,
          key: uploaded.key,
          provider: uploaded.provider,
        },
      },
    };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @GetUserDocs()
  async findOne(@Param('id', ParseUuidPipe) id: string) {
    const data = await this.proxy.sendUser<UserProfileView>(
      USER_PATTERNS.FIND_ONE,
      { id },
    );
    return { message: USER_SUCCESS_MESSAGES.USER_FETCHED, data };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @UpdateUserDocs()
  async update(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateProfileDto,
  ) {
    const profile = await this.proxy.sendUser<UserProfileView>(
      USER_PATTERNS.FIND_ONE,
      { id },
    );
    const data = await this.proxy.sendUser<UserProfileView>(
      USER_PATTERNS.UPDATE,
      {
        userId: profile.userId,
        ...dto,
      },
    );
    return { message: USER_SUCCESS_MESSAGES.USER_UPDATED, data };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @DeleteUserDocs()
  async remove(@Param('id', ParseUuidPipe) id: string) {
    const profile = await this.proxy.sendUser<UserProfileView>(
      USER_PATTERNS.FIND_ONE,
      { id },
    );
    await this.proxy.sendAuth(AUTH_PATTERNS.DEACTIVATE, {
      userId: profile.userId,
    });
    const data = await this.proxy.sendUser(USER_PATTERNS.REMOVE, {
      userId: profile.userId,
    });
    return { message: USER_SUCCESS_MESSAGES.USER_DELETED, data };
  }
}
