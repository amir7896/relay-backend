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
} from '@app/common';
import { AUTH_PATTERNS, USER_PATTERNS } from '@app/contracts';
import type { UserProfileView } from '@app/contracts';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { StorageService } from '../storage/storage.service';
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

@UsersDocs()
@Controller('users')
export class UsersController {
  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly storage: StorageService,
  ) {}

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
    const data = await this.proxy.sendUser<UserProfileView>(
      USER_PATTERNS.FIND_BY_USER_ID,
      {
        userId: user.id,
      },
    );
    return { message: USER_SUCCESS_MESSAGES.PROFILE_FETCHED, data };
  }

  @Get('directory')
  @ListDirectoryDocs()
  async directory(@Query() query: PaginationQueryDto) {
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
    if (dto.avatar !== undefined) {
      const current = await this.proxy.sendUser<UserProfileView>(
        USER_PATTERNS.FIND_BY_USER_ID,
        { userId: user.id },
      );
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

    const current = await this.proxy.sendUser<UserProfileView>(
      USER_PATTERNS.FIND_BY_USER_ID,
      { userId: user.id },
    );

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
