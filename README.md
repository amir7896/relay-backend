# NestJS Microservices Platform

Production-style NestJS monorepo with an HTTP API Gateway, Auth and User microservices, PostgreSQL + TypeORM migrations, RabbitMQ for inter-service communication, Redis for gateway cache and token blacklist, Swagger, and consistent API responses.

## Architecture

```
Client
  │
  ▼
API Gateway :3002
  • REST + Swagger (`/api/docs`) + Socket.IO `/chat`
  • JWT auth, RBAC, DTO validation
  • Redis cache, rate limit, token blacklist
  │
  ├─ RabbitMQ `auth_queue` ──► Auth Service  ── PostgreSQL (`AUTH_POSTGRES_DATABASE`)
  ├─ RabbitMQ `user_queue` ──► User Service  ── PostgreSQL (`USER_POSTGRES_DATABASE`)
  └─ RabbitMQ `chat_queue` ──► Chat Service  ── PostgreSQL (`CHAT_POSTGRES_DATABASE`)
```

Each service owns its database. The gateway never talks to PostgreSQL directly.

## Stack

| Area | Choice |
| --- | --- |
| Framework | NestJS 11 monorepo |
| Transport | RabbitMQ (`amqplib`) |
| Gateway extras | Redis cache, JWT blacklist, throttling |
| Database | PostgreSQL 17 + TypeORM (`synchronize: false`) |
| Docs | Swagger / OpenAPI |
| Validation | `class-validator` global pipe |
| Logging | Pino |
| Security | Helmet, CORS, bcryptjs (12 rounds), JWT access + refresh |

## Project layout

```
apps/
  api-gateway/src/
    app.module.ts                 root: config, redis, global guards/filters
    main.ts
    auth/                         HTTP auth feature
      auth.module.ts
      auth.controller.ts
      dto/  swagger/  guards/  strategies/
    users/                        HTTP users feature
    chat/                         HTTP chat + Socket.IO gateway
    health/                       liveness + RabbitMQ/Redis readiness
    infrastructure/proxy/         RabbitMQ ClientProxy wrapper
  auth-service/src/
    app.module.ts                 root: config + TypeORM
    auth/                         message handlers + domain service
    database/                     entities, migrations, data-source
  user-service/src/
    app.module.ts
    users/
    database/
  chat-service/src/
    app.module.ts
    chat/
    database/
libs/
  common/                         envelopes, pipes, Redis, RMQ, env
  contracts/                      message patterns + payloads (auth/, users/, chat/)
  database/                       shared TypeORM factory
```

## What you need on the machine

| Tool | Why | Default port |
| --- | --- | --- |
| Node.js 20+ and npm | Run the Nest apps | Gateway `3002`, Auth `3001`, Users `3003`, Chat `3004` |
| Docker Engine + Compose | Recommended way to run Postgres, RabbitMQ, Redis | — |
| PostgreSQL | Auth DB + Users DB + Chat DB | `5432` |
| RabbitMQ | Gateway ↔ microservice messages | AMQP `5672`, UI `15672` |
| Redis | Gateway cache + access-token blacklist | `6379` |

You can run Postgres, RabbitMQ, and Redis **all in Docker**, or mix Docker with services already installed locally. `.env` must match whichever host and credentials you actually use.

## 1. Install Node.js

**Ubuntu / Debian**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # v20 or newer
npm -v
```

**macOS** (Homebrew)

```bash
brew install node@22
```

**Windows** — install the LTS build from [https://nodejs.org](https://nodejs.org).

## 2. Install Docker

Docker is the easiest way to start PostgreSQL, RabbitMQ, and Redis together.

**Ubuntu / Debian**

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in (or reboot) so the `docker` group applies. Until then, prefix Docker commands with `sudo`.

Check:

```bash
docker --version
docker compose version
```

**macOS / Windows** — install [Docker Desktop](https://docs.docker.com/get-docker/). It includes Compose.

Official docs: [Install Docker Engine](https://docs.docker.com/engine/install/).

## 3. Install RabbitMQ (optional, if you skip Docker)

Prefer Docker (`npm run docker:up`) unless you already run RabbitMQ on the host.

**Ubuntu / Debian**

```bash
sudo apt-get update
sudo apt-get install -y rabbitmq-server
sudo systemctl enable --now rabbitmq-server
sudo rabbitmq-plugins enable rabbitmq_management
```

Create a user that matches `.env` (`RABBITMQ_USER` / `RABBITMQ_PASSWORD`):

```bash
sudo rabbitmqctl add_user nest nest
sudo rabbitmqctl set_user_tags nest administrator
sudo rabbitmqctl set_permissions -p / nest ".*" ".*" ".*"
```

Management UI: http://localhost:15672

**macOS**

```bash
brew install rabbitmq
brew services start rabbitmq
```

If you use a local RabbitMQ instead of the container, do **not** start the `rabbitmq` service in Compose, or change `RABBITMQ_PORT` so the two do not collide on `5672`.

## 4. Clone, env, and install packages

There is one `.env` at the **project root**. Nest apps and `docker compose` both read it. Do not commit `.env`.

```bash
cd ~/Documents/Nodejs/Nestjs-Micro-Services
cp .env.example .env
npm install
```

Then edit `.env`. Put your own values. Compose and the Nest apps read the same keys.

If you already have local Postgres, Redis, or RabbitMQ, use those credentials. If you use Compose, keep the same keys in `.env`; Compose creates the two databases only on a fresh Postgres volume.

### Environment keys

**App / runtime**

- `NODE_ENV`
- `GATEWAY_PORT`
- `GATEWAY_GLOBAL_PREFIX`
- `SWAGGER_ENABLED`
- `CORS_ORIGIN`
- `AUTH_HTTP_PORT`
- `USER_HTTP_PORT`
- `CHAT_HTTP_PORT`

**JWT** (gateway + auth)

- `JWT_ACCESS_SECRET`
- `JWT_ACCESS_EXPIRES_IN`
- `JWT_REFRESH_SECRET`
- `JWT_REFRESH_EXPIRES_IN`

**Admin** (auth)

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

**PostgreSQL** (auth + users + chat + Compose)

- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `AUTH_POSTGRES_DATABASE`
- `USER_POSTGRES_DATABASE`
- `CHAT_POSTGRES_DATABASE`

**RabbitMQ** (all apps + Compose)

- `RABBITMQ_HOST`
- `RABBITMQ_PORT`
- `RABBITMQ_USER`
- `RABBITMQ_PASSWORD`
- `RABBITMQ_VHOST`

**Redis + gateway limits** (gateway)

- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`
- `REDIS_DB`
- `CACHE_TTL_SECONDS`
- `THROTTLE_TTL_SECONDS`
- `THROTTLE_LIMIT`

**File storage** (gateway — chat images / voice)

- `STORAGE_DRIVER` — `local` (default) | `s3` | `cloudinary`
- `STORAGE_LOCAL_DIR` — local only (default `uploads`)
- S3: `STORAGE_S3_REGION`, `STORAGE_S3_BUCKET`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY`, optional `STORAGE_S3_ENDPOINT`, `STORAGE_S3_PUBLIC_URL`, `STORAGE_S3_FORCE_PATH_STYLE`, `STORAGE_S3_PREFIX`
- Cloudinary: `STORAGE_CLOUDINARY_CLOUD_NAME`, `STORAGE_CLOUDINARY_API_KEY`, `STORAGE_CLOUDINARY_API_SECRET`, `STORAGE_CLOUDINARY_FOLDER`

Who reads which keys:

- **API Gateway:** app/runtime gateway keys, JWT, Redis, throttle, CORS, Swagger, RabbitMQ, file storage
- **Auth Service:** JWT, admin keys, Postgres, `AUTH_POSTGRES_DATABASE`, RabbitMQ
- **User Service:** Postgres, `USER_POSTGRES_DATABASE`, RabbitMQ
- **Chat Service:** Postgres, `CHAT_POSTGRES_DATABASE`, RabbitMQ

## 5. Start infrastructure

From the project root (the folder that contains `docker-compose.yml`):

```bash
npm run docker:up
# equivalent: docker compose up -d
```

Use `sudo npm run docker:up` if your user is not in the `docker` group yet.

This starts **RabbitMQ** (`nest-rabbitmq`). That is the usual setup when PostgreSQL and Redis are already installed on the machine (ports `5432` and `6379`). `.env` should keep `POSTGRES_HOST=localhost` and `REDIS_HOST=localhost`.

To run Postgres, RabbitMQ, and Redis **all in Docker** (only if those host ports are free):

```bash
npm run docker:up:all
```

That starts:

- `nest-postgres` — PostgreSQL 17
- `nest-rabbitmq` — RabbitMQ 4 + management UI
- `nest-redis` — Redis 7

Stop the stack (volumes are kept):

```bash
npm run docker:down
```

### Port already in use

If `docker:up:all` prints `failed to bind host port ... address already in use`, a local service already owns that port.

| Port | Typical owner |
| --- | --- |
| `5432` | Local PostgreSQL |
| `5672` / `15672` | Local RabbitMQ |
| `6379` | Local Redis |

Either stop the local service:

```bash
sudo systemctl stop postgresql
sudo systemctl stop rabbitmq-server
sudo systemctl stop redis
# then
npm run docker:up:all
```

Or keep the local Postgres/Redis and start only RabbitMQ:

```bash
npm run docker:up
```

In that case `.env` must point at the local Postgres/Redis (`localhost` and those credentials).

Changing `POSTGRES_USER` or database names after the first `docker:up:all` does **not** update an existing volume. Recreate Postgres data once if credentials changed:

```bash
npm run docker:down
docker volume rm backend_postgres_data
npm run docker:up:all
```

## 6. Databases and migrations

Create both schemas (run from the project root, with Postgres reachable):

```bash
npm run migration:run
```

Other commands:

```bash
npm run migration:auth:run
npm run migration:users:run
npm run migration:auth:generate -- apps/auth-service/src/database/migrations/AddSomething
npm run migration:auth:revert
```

Never enable TypeORM `synchronize`. Schema changes go through migrations. After pulling new migration files, run `npm run migration:run` again so pending indexes apply.

## 7. Run the apps

```bash
npm run start:dev
```

That watches the API Gateway, Auth Service, User Service, and Chat Service together. Stop with `Ctrl+C`.

| URL | What |
| --- | --- |
| http://localhost:3002/api | API |
| http://localhost:3002/api/docs | Swagger |
| http://localhost:3002/api/health | Gateway + RabbitMQ + Redis health |
| ws://localhost:3002/chat | Socket.IO chat namespace |
| http://localhost:15672 | RabbitMQ UI (user/password from `.env`) |

Log in at `/api/docs`, then use **Authorize** and paste the access token.

A Vite + React 18.3 product UI (**Relay**) lives in [`Ms-Frontend`](./Ms-Frontend): landing, sign-in, messenger, and profile. With the gateway running: `npm run start:frontend` then open http://127.0.0.1:5173.

## Chat

REST under `/api/chat` (JWT required). Step-by-step Postman requests (including Socket.IO) are in [`Chat-Postman-Testing.pdf`](./Chat-Postman-Testing.pdf).

- `POST /api/chat/private` — start or reuse a 1:1 conversation (`userId` is the other account id)
- `POST /api/chat/groups` — create a group
- `GET /api/chat/conversations` — list my chats (`unreadCount`, member `status`)
- `GET /api/chat/conversations/:id/messages` — history (newest first; each message has `type` and `seenBy`)
- `POST /api/chat/conversations/:id/messages` — send a message (`type` defaults to `text`)
- `POST /api/chat/conversations/:id/typing` — broadcast typing
- `POST /api/chat/conversations/:id/seen` — mark messages as seen
- `GET /api/chat/presence/:userId` — `online` or `offline`

Realtime: connect Socket.IO to `/chat` with `auth: { token: '<accessToken>' }`. On connect the socket joins only `user:{id}` (cheap). Open a conversation with `chat:join` so typing/presence land in that room; messages also fan out to each member’s `user:{id}` room. Client events: `chat:join`, `chat:message`, `chat:typing`, `chat:seen`, `chat:heartbeat`. Server emits `chat:message`, `chat:typing`, `chat:seen`, and `chat:presence`.

Create the chat database once (`CHAT_POSTGRES_DATABASE` in `.env`), then `npm run migration:chat:run`. Existing Compose volumes do not pick up new databases until you create them manually.

## Performance and high concurrency

A single Node process cannot hold 1,000,000 open sockets. This platform is built so many users can call APIs at once: extra requests **wait in line** for a free RabbitMQ slot (they are not turned away with 503), and you scale out with more gateway workers and more auth/user/chat consumers.

What is in the code:

- **Socket.IO Redis adapter** so several gateway workers share chat rooms and presence
- **Optional `GATEWAY_WORKERS`** (set `0` to use all CPU cores)
- **In-flight queue** (`GATEWAY_MAX_INFLIGHT`) — at most N RabbitMQ round-trips run at once; extra calls wait FIFO and still complete
- **PostgreSQL connection pools** (`POSTGRES_POOL_MAX`) instead of one DB connection per request
- **RabbitMQ prefetch** and durable queues; gateway ClientProxy keeps `noAck: true`
- **JWT VALIDATE cache** in Redis (short TTL) so every HTTP/WS call does not hit Auth Service
- **Cheap WebSocket connect** (join `user:{id}` only; no list-all-conversations query)
- **Chat indexes** on `(conversationId, createdAt)` for message history and unread counts
- **Timeouts**, Helmet, compression, body-size limit, trust proxy, login rate limits
- **Production access logs off**; Redis `volatile-lru`; Postgres `max_connections`

Full Postman steps, Docker/migration commands, and this performance list are in [`Chat-Postman-Testing.pdf`](./Chat-Postman-Testing.pdf).

## Auth on local

Register always creates role `user`. Set `ADMIN_EMAIL` (and `ADMIN_PASSWORD` if the user does not exist yet) in `.env` and restart `start:dev`. Auth Service promotes that email or creates the account. Log in again so the new access token has role `admin`.

## Useful scripts

| Script | Purpose |
| --- | --- |
| `npm run start:dev` | Watch all four apps |
| `npm run start:gateway` | Gateway only |
| `npm run start:auth` | Auth service only |
| `npm run start:users` | User service only |
| `npm run start:chat` | Chat service only |
| `npm run start:frontend` | Relay UI (`Ms-Frontend`, port 5173) |
| `npm run migration:run` | Apply auth, users, and chat migrations |
| `npm run docker:up` | Start RabbitMQ (use host Postgres/Redis if those ports are taken) |
| `npm run docker:up:all` | Start PostgreSQL, RabbitMQ, and Redis in Docker |
| `npm run docker:down` | Stop Compose containers (keep volumes) |

## Industry practices included

- Database-per-service and explicit TypeORM migrations
- Shared contracts library instead of leaking entities across services
- Dedicated RabbitMQ queues per service
- Global validation pipe with whitelist / forbidNonWhitelisted
- Exception filters that never leak stack traces in production
- Request IDs on every response
- Soft deletes on user profiles
- Refresh-token rotation and hashed token storage
- Redis-backed gateway cache, access-token blacklist, presence, and Socket.IO adapter
- Structured logging and health checks
- Connection pools, FIFO in-flight queue, request timeouts, and horizontal gateway workers
