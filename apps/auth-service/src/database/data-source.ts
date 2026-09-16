import { config } from 'dotenv';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { AuthUser } from './entities/auth-user.entity';
import { AuthToken } from './entities/auth-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { Organization } from './entities/organization.entity';
import { OrganizationMember } from './entities/organization-member.entity';
import { CreateAuthSchema1710000000000 } from './migrations/1710000000000-CreateAuthSchema';
import { AuthPartialUniqueAndTokenIndexes1720000000000 } from './migrations/1720000000000-AuthPartialUniqueAndTokenIndexes';
import { CreateAuthTokens1730000000000 } from './migrations/1730000000000-CreateAuthTokens';
import { CreateOrganizations1741000000000 } from './migrations/1741000000000-CreateOrganizations';
import { DropOrganizationDatabaseColumns1742000000000 } from './migrations/1742000000000-DropOrganizationDatabaseColumns';
import { AddInviteOrganizationId1743000000000 } from './migrations/1743000000000-AddInviteOrganizationId';
import { AddTwoFactorSessionsBillingSso1743000002000 } from './migrations/1743000002000-AddTwoFactorSessionsBillingSso';
import { AddStripeBillingColumns1743000003000 } from './migrations/1743000003000-AddStripeBillingColumns';
import { AddSsoSecretInviteRoleGuest1743000004000 } from './migrations/1743000004000-AddSsoSecretInviteRoleGuest';
import { AddPendingChannelIdToAuthTokens1743000005000 } from './migrations/1743000005000-AddPendingChannelIdToAuthTokens';
import { AddSamlSsoFields1743000006000 } from './migrations/1743000006000-AddSamlSsoFields';

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
  database: process.env.AUTH_POSTGRES_DATABASE ?? 'nest_auth',
  entities: [
    AuthUser,
    RefreshToken,
    AuthToken,
    Organization,
    OrganizationMember,
  ],
  migrations: [
    CreateAuthSchema1710000000000,
    AuthPartialUniqueAndTokenIndexes1720000000000,
    CreateAuthTokens1730000000000,
    CreateOrganizations1741000000000,
    DropOrganizationDatabaseColumns1742000000000,
    AddInviteOrganizationId1743000000000,
    AddTwoFactorSessionsBillingSso1743000002000,
    AddStripeBillingColumns1743000003000,
    AddSsoSecretInviteRoleGuest1743000004000,
    AddPendingChannelIdToAuthTokens1743000005000,
    AddSamlSsoFields1743000006000,
  ],
  synchronize: false,
});
