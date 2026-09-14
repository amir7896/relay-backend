import { config } from 'dotenv';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { UserProfile } from './entities/user-profile.entity';
import { CreateUserSchema1710000000001 } from './migrations/1710000000001-CreateUserSchema';
import { UserPartialUniqueUserId1720000000001 } from './migrations/1720000000001-UserPartialUniqueUserId';
import { AddShowLastSeenPrivacy1730000004000 } from './migrations/1730000004000-AddShowLastSeenPrivacy';
import { WidenAvatarUrl1740000000001 } from './migrations/1740000000001-WidenAvatarUrl';
import { SharedTenantUserOrganizationId1742000000001 } from './migrations/1742000000001-SharedTenantUserOrganizationId';

config({
  path: [
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '../../../../.env'),
  ],
});

export default new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  username: process.env.POSTGRES_USER ?? 'nest',
  password: process.env.POSTGRES_PASSWORD ?? 'nest',
  database: process.env.USER_POSTGRES_DATABASE ?? 'nest_users',
  entities: [UserProfile],
  migrations: [
    CreateUserSchema1710000000001,
    UserPartialUniqueUserId1720000000001,
    AddShowLastSeenPrivacy1730000004000,
    WidenAvatarUrl1740000000001,
    SharedTenantUserOrganizationId1742000000001,
  ],
  synchronize: false,
});
