import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsOrder, ILike, QueryFailedError, Repository } from 'typeorm';
import { RpcErrors, buildPaginatedResult, getSkipTake } from '@app/common';
import type {
  CreateProfilePayload,
  FindUsersPayload,
  UpdateProfilePayload,
  UserProfileView,
} from '@app/contracts';
import { requireOrganizationId } from '@app/database';
import { UserProfile } from '../database/entities/user-profile.entity';

const ALLOWED_SORT = new Set([
  'createdAt',
  'updatedAt',
  'firstName',
  'lastName',
  'email',
]);

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserProfile)
    private readonly profiles: Repository<UserProfile>,
  ) {}

  async createProfile(payload: CreateProfilePayload): Promise<UserProfileView> {
    const organizationId = requireOrganizationId();
    const existing = await this.profiles.findOne({
      where: { organizationId, userId: payload.userId },
    });
    if (existing) {
      return this.toView(existing);
    }

    const profile = this.profiles.create({
      organizationId,
      userId: payload.userId,
      email: payload.email.toLowerCase().trim(),
      firstName: payload.firstName.trim(),
      lastName: payload.lastName.trim(),
    });

    try {
      const saved = await this.profiles.save(profile);
      return this.toView(saved);
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const existingAfterConflict = await this.profiles.findOne({
          where: { organizationId, userId: payload.userId },
        });
        if (existingAfterConflict) {
          return this.toView(existingAfterConflict);
        }
      }
      throw error;
    }
  }

  async findAll(query: FindUsersPayload) {
    const organizationId = requireOrganizationId();
    const { skip, take } = getSkipTake(query.page, query.limit);
    const sortBy = ALLOWED_SORT.has(query.sortBy) ? query.sortBy : 'createdAt';
    const order = { [sortBy]: query.order } as FindOptionsOrder<UserProfile>;

    const [items, total] = await this.profiles.findAndCount({
      where: query.search
        ? [
            { organizationId, firstName: ILike(`%${query.search}%`) },
            { organizationId, lastName: ILike(`%${query.search}%`) },
            { organizationId, email: ILike(`%${query.search}%`) },
          ]
        : { organizationId },
      order,
      skip,
      take,
    });

    return buildPaginatedResult(
      items.map((item) => this.toView(item)),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(id: string): Promise<UserProfileView> {
    const profile = await this.profiles.findOne({
      where: { id, organizationId: requireOrganizationId() },
    });
    if (!profile) {
      return RpcErrors.notFound('User');
    }
    return this.toView(profile);
  }

  async findByUserId(userId: string): Promise<UserProfileView> {
    const profile = await this.profiles.findOne({
      where: { userId, organizationId: requireOrganizationId() },
    });
    if (!profile) {
      return RpcErrors.notFound('User profile');
    }
    return this.toView(profile);
  }

  async update(payload: UpdateProfilePayload): Promise<UserProfileView> {
    const profile = await this.profiles.findOne({
      where: {
        userId: payload.userId,
        organizationId: requireOrganizationId(),
      },
    });
    if (!profile) {
      return RpcErrors.notFound('User profile');
    }

    profile.firstName = payload.firstName?.trim() ?? profile.firstName;
    profile.lastName = payload.lastName?.trim() ?? profile.lastName;
    profile.phone = payload.phone ?? profile.phone;
    profile.bio = payload.bio ?? profile.bio;
    if (payload.avatar !== undefined) {
      const next = payload.avatar?.trim() || null;
      profile.avatar = next;
    }
    profile.dateOfBirth = payload.dateOfBirth ?? profile.dateOfBirth;
    if (typeof payload.showLastSeen === 'boolean') {
      profile.showLastSeen = payload.showLastSeen;
    }

    const saved = await this.profiles.save(profile);
    return this.toView(saved);
  }

  async remove(userId: string): Promise<{ deleted: boolean }> {
    const profile = await this.profiles.findOne({
      where: { userId, organizationId: requireOrganizationId() },
    });
    if (!profile) {
      return RpcErrors.notFound('User profile');
    }
    await this.profiles.softRemove(profile);
    return { deleted: true };
  }

  async purgeByOrganization(organizationId: string): Promise<{ deleted: number }> {
    const result = await this.profiles.delete({ organizationId });
    return { deleted: result.affected ?? 0 };
  }

  private toView(profile: UserProfile): UserProfileView {
    return {
      id: profile.id,
      userId: profile.userId,
      organizationId: profile.organizationId,
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      phone: profile.phone,
      bio: profile.bio,
      avatar: profile.avatar,
      dateOfBirth: profile.dateOfBirth,
      showLastSeen: profile.showLastSeen !== false,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}
