# ENEXUR Growth OS — Orchestrator Foundation

This folder introduces a backend foundation beside the existing ENEXUR Global Market Access OS prototype. It does **not** replace the current frontend or connect live providers by itself.

## Current scope

- One workflow state machine and specialist-routing registry.
- Six bounded specialist roles.
- Authenticated API endpoints for creating, listing, reading, transitioning and auditing workflows.
- MongoDB persistence when configured; explicit in-memory development fallback when not configured.
- Policy gates for contact verification, outreach authorization/suppression, qualification evidence, commercial approval, payment-provider verification, executed contract, kickoff prerequisites, mandatory deliverables, QA, CEO approval and final delivery.
- Node test suite for critical gates.

## Not yet implemented

This is the first foundation, not a production-ready autonomous sales platform. No CRM, prospecting provider, email, LinkedIn, payment processor, e-signature provider, client portal, AI model or report-generation integration is connected by this API. It does not perform live outreach or charge customers. Provider adapters, robust queue/orchestration, tenant-scoped access, formal audit integrity, operational observability, and end-to-end integration tests remain required.

## Local development

Requires Node.js 20+.

```bash
cd growth-os
npm install
cp .env.example .env
# Set MONGODB_URI for durable persistence.
# For local-only testing you may set DEV_AUTH_BYPASS=true.
npm run check
npm test
npm start
```

The API listens on port 8080 by default. `GET /health` is a health check. Protected endpoints require a bearer token. In local development only, `DEV_AUTH_BYPASS=true` grants a simulated CEO actor; never enable this in production.

## Environment

- `PORT`: HTTP port, default 8080.
- `NODE_ENV`: set to `production` for production.
- `MONGODB_URI`: MongoDB connection string; required for persistence.
- `MONGODB_DB`: database name, default `enexur_growth_os`.
- `GROWTH_OS_API_TOKEN`: server-to-server API token.
- `GROWTH_OS_CEO_TOKEN`: separate CEO token used for final release approval.
- `DEV_AUTH_BYPASS`: local development only; default false.

Generate strong random secrets and keep them in a secret manager. Never commit real tokens or connection strings.

## Endpoints

- `GET /health` — health status.
- `GET /api/v1/meta` — states and specialist roles (authenticated).
- `GET /api/v1/workflows` — list workflows; optional `state` and `limit`.
- `POST /api/v1/workflows` — create a prospect workflow; JSON body must include `companyName`.
- `GET /api/v1/workflows/:id` — read workflow.
- `POST /api/v1/workflows/:id/transition` — transition with `toState`, `expectedVersion`, and evidence object.
- `GET /api/v1/workflows/:id/audit` — audit events.

## CEO release rule

The `APPROVED_FOR_RELEASE` transition requires the CEO token and explicit evidence that the CEO decision is `APPROVE`, QA passed, and no critical defects remain. The final `DELIVERED` transition requires release approval. Payment must be verified by an authoritative payment-provider or authorized finance integration before an order can transition to `PAID`.

## Next engineering milestones

1. Replace demo-mode assumptions with tenant-scoped authentication and authorization.
2. Add a durable queue/workflow engine with retries, leases, idempotency keys and dead-letter handling.
3. Add provider adapters with explicit capability and permission checks.
4. Connect HubSpot CRM with schema discovery and reconciliation before any writes.
5. Consolidate the two existing four-hour acquisition briefs into one scheduled acquisition workflow, preserving prospect-enrichment fallback.
6. Add payment webhook signature verification and reconciliation.
7. Add contract lifecycle and client project workspace integrations.
8. Implement product-specific research pipelines, source registry, QA rubric and CEO review UI.
9. Add CI, integration tests, observability, rate limits, backups and incident runbooks.
10. Run a controlled pilot before enabling any production side effects.
