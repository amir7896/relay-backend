import { SetMetadata } from '@nestjs/common';

export const SKIP_ORG_KEY = 'skipOrg';
/** Routes that do not require X-Organization-Id */
export const SkipOrg = () => SetMetadata(SKIP_ORG_KEY, true);
