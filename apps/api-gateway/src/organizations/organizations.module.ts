import { Module } from '@nestjs/common';
import { ProxyModule } from '../infrastructure/proxy/proxy.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationGuard } from './organization.guard';

@Module({
  imports: [ProxyModule],
  controllers: [OrganizationsController],
  providers: [OrganizationGuard],
  exports: [OrganizationGuard],
})
export class OrganizationsModule {}
