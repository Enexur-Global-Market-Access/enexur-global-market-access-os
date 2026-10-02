# ENEXUR Global Market Access OS™

Tenant-aware SaaS foundation for market entry assessment, account management, and commercial opportunity execution.

## Current delivery

This repository now contains a working full-stack foundation rather than the static Pages prototype. It includes a React responsive workspace, Fastify API, PostgreSQL/Prisma relational schema, server-side password hashing and sessions, workspace membership roles, tenant-scoped account/opportunity/assessment operations, audit events for creation, and a server-calculated 15-dimension India Market Entry Score. Dashboard values are queried from persisted records. Features that need a third-party account are shown as disconnected and do not claim successful external actions.

This is an MVP foundation, **not a production-ready launch**. Email verification and password reset delivery, invitations and user management, MFA/OAuth, an external job queue, file storage, AI/research providers, CRM/email/payment integrations, billing, deep audit review, security review, and end-to-end tenant/security tests remain to be implemented and configured. Production also needs a TLS reverse proxy, managed PostgreSQL, secret management, backups, and monitoring.

## Run locally

Requirements: Node.js 22+, pnpm 11+, and Docker with Compose.

1. Copy `.env.example` to `.env`. Its matching database values are for local development only; replace both `POSTGRES_PASSWORD` and the password in `DATABASE_URL` together before use. Set `WEB_ORIGIN=http://localhost:8080` for Compose or `http://localhost:5173` for the Vite client.
2. Start PostgreSQL with `docker compose up -d db`.
3. Install packages with `pnpm install`.
4. Generate Prisma Client and create the development database schema: `pnpm db:generate`, then `pnpm db:dev`.
5. Start the API in one terminal with `pnpm dev`.
6. Start the web app in another terminal with `pnpm dev:web` and open `http://localhost:5173`.

The application does not seed fictitious accounts automatically. Create a real development workspace through the sign-up screen. Never use production customer data in local development.

## API

- `GET /api/health` — application and database status
- `GET /api/auth/csrf` — issue CSRF token for cookie-authenticated mutations
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET /api/dashboard` — live workspace aggregates
- `GET|POST /api/companies`, `PATCH|DELETE /api/companies/:id`
- `GET|POST /api/opportunities`, `PATCH /api/opportunities/:id`
- `GET|POST /api/assessments`, `POST /api/assessments/:id/submit`
- `GET /api/integrations`
- `GET /api/audit-logs`

All private data queries include the authenticated workspace ID. Role permissions are enforced by API pre-handlers; UI visibility is not the security boundary. Mutations also require a CSRF header and same-site session cookie. Registration applies account and organization limits; global API rate limiting and secure response headers are enabled.

## Deployment shape

`docker-compose.yml` describes PostgreSQL, the API, and Nginx-hosted web client for a single-machine staging setup. Configure HTTPS at a trusted edge proxy and use managed secrets/database/storage for production. Do not point the existing GitHub Pages static deployment at this code: Pages cannot run the database-backed API. The existing prototype can remain available as a separate public preview until a backend-capable host is configured.

## Tests and checks

`pnpm build` runs TypeScript validation and a production frontend build. `pnpm test` runs score calculation tests. Database-backed auth, RBAC, tenant-isolation, CRUD, queue, billing, integrations, AI approval, and report-export suites are still outstanding and must pass against an isolated PostgreSQL test database before launch.
