import { AsyncLocalStorage } from 'node:async_hooks';
import type { OrganizationView } from '@app/contracts';

export type GatewayTenantContext = OrganizationView;

export const gatewayTenantAls =
  new AsyncLocalStorage<GatewayTenantContext>();

export function getGatewayTenant(): GatewayTenantContext | undefined {
  return gatewayTenantAls.getStore();
}

export function tenantRpcFields(tenant?: GatewayTenantContext) {
  if (!tenant) {
    return {};
  }
  return {
    organizationId: tenant.id,
  };
}
