# Multi-tenant architecture (shared DB)

## Model

| Layer | Storage | Purpose |
|-------|---------|---------|
| **Control plane** | Shared `AUTH_POSTGRES_DATABASE` | Users, orgs, memberships, invites |
| **Users data** | Shared `USER_POSTGRES_DATABASE` | Profiles scoped by `organizationId` |
| **Chat data** | Shared `CHAT_POSTGRES_DATABASE` | Conversations/messages scoped by `organizationId` |

All organizations share the same three Postgres databases. Isolation is row-level via `organizationId` (Slack-style), not separate databases per org.

## API contract

Authenticated tenant APIs require:

```http
X-Organization-Id: <uuid>
Authorization: Bearer <access>
```

Org management (no header required):

- `GET /api/organizations`
- `POST /api/organizations`
- `GET /api/organizations/:organizationId`

Gateway resolves membership, then injects into every user/chat RPC:

```json
{
  "organizationId": "..."
}
```

## Frontend

Session stores `organizations` + `activeOrganizationId`. The API client sends `X-Organization-Id` on non-auth requests. AppShell includes an org switcher.

## Ops notes

- After pull: run auth, users, and chat migrations.
- Restart services so auth bootstraps the default org (`slug=default`) and memberships.
- Creating an organization does **not** create new Postgres databases.
