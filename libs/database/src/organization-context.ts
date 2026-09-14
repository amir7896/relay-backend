import { AsyncLocalStorage } from 'node:async_hooks';

type OrgStore = { organizationId: string };

const organizationAls = new AsyncLocalStorage<OrgStore>();

export function runWithOrganization<T>(organizationId: string, fn: () => T): T {
  if (!organizationId?.trim()) {
    throw new Error('organizationId is required');
  }
  return organizationAls.run({ organizationId: organizationId.trim() }, fn);
}

export function getOrganizationId(): string | undefined {
  return organizationAls.getStore()?.organizationId;
}

export function requireOrganizationId(): string {
  const id = getOrganizationId();
  if (!id) {
    throw new Error(
      'Organization context missing. Handlers must run inside runWithOrganization().',
    );
  }
  return id;
}
