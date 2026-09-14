export interface CreateProfilePayload {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId?: string;
}

export interface UpdateProfilePayload {
  userId: string;
  organizationId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  bio?: string;
  avatar?: string;
  dateOfBirth?: string;
  showLastSeen?: boolean;
}

export interface FindUsersPayload {
  page: number;
  limit: number;
  search?: string;
  sortBy: string;
  order: 'ASC' | 'DESC';
  organizationId?: string;
}

export interface PurgeOrganizationUsersPayload {
  organizationId: string;
  actorId: string;
}

export interface UserProfileView {
  id: string;
  userId: string;
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  bio: string | null;
  avatar: string | null;
  dateOfBirth: string | null;
  showLastSeen: boolean;
  createdAt: string;
  updatedAt: string;
}
