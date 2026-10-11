import express from "express";
import { randomUUID } from "node:crypto";
import {
  buildAuditEvent, createWorkflow, routeSpecialist, transitionWorkflow, WORKFLOW_STATES
} from "./domain.js";
import {
  closeStore, connectStore, getWorkflow, insertWorkflow, listAuditEvents,
  listWorkflows, makeId, updateWorkflowAndAudit
} from "./store.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

const PORT = Number(process.env.PORT || 8080);
const NODE_ENV = process.env.NODE_ENV || "development";
const API_TOKEN = process.env.GROWTH_OS_API_TOKEN;
const CEO_TOKEN = process.env.GROWTH_OS_CEO_TOKEN;
const FINANCE_TOKEN = process.env.GROWTH_OS_FINANCE_TOKEN;

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function auth(req, res, next) {
  if (NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "true") {
    req.actor = { id: "local-dev", role: "ceo" };
    return next();
  }
  const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (CEO_TOKEN && safeEqual(token, CEO_TOKEN)) {
    req.actor = { id: "ceo-token", role: "ceo" };
    return next();
  }
  if (FINANCE_TOKEN && safeEqual(token, FINANCE_TOKEN)) {
    req.actor = { id: "finance-token", role: "finance" };
    return next();
  }
  if (API_TOKEN && safeEqual(token, API_TOKEN)) {
    req.actor = { id: "api-service", role: "agent" };
    return next();
  }
  return res.status(401).json({ error: "UNAUTHORIZED", message: "Valid Growth OS API credentials are required." });
}

function handleError(res, error) {
  const message = error?.message || "INTERNAL_ERROR";
  const known = new Set([
    "WORKFLOW_NOT_FOUND_OR_INVALID", "INVALID_TRANSITION", "WORKFLOW_TERMINAL",
    "CEO_APPROVAL_REQUIRED", "VERIFIED_CONTACT_REQUIRED", "OUTREACH_APPROVAL_REQUIRED",
    "CONTACT_SUPPRESSED", "AUTHORIZED_CHANNEL_REQUIRED", "QUALIFICATION_EVIDENCE_INCOMPLETE",
    "COMMERCIAL_APPROVAL_REQUIRED", "PAYMENT_NOT_VERIFIED", "EXECUTED_CONTRACT_REQUIRED",
    "ENGAGEMENT_KICKOFF_PREREQUISITES_REQUIRED", "MANDATORY_DELIVERABLES_INCOMPLETE",
    "QA_RELEASE_GATE_FAILED", "CEO_RELEASE_APPROVAL_AND_QA_REQUIRED", "APPROVED_RELEASE_REQUIRED",
    "COMPANY_NAME_REQUIRED", "DUPLICATE_WORKFLOW_ID", "VERSION_CONFLICT", "WORKFLOW_NOT_FOUND"
  ]);
  const status = message === "CEO_APPROVAL_REQUIRED" ? 403 :
    message === "WORKFLOW_NOT_FOUND" || message === "WORKFLOW_NOT_FOUND_OR_INVALID" ? 404 :
    message === "VERSION_CONFLICT" || message === "DUPLICATE_WORKFLOW_ID" ? 409 :
    known.has(message) || message.startsWith("INVALID_TRANSITION:") ? 422 : 500;
  res.status(status).json({ error: known.has(message) || message.startsWith("INVALID_TRANSITION:") ? message : "REQUEST_FAILED" });
}

app.get("/health", (_req, res) => res.json({
  service: "enexur-growth-os",
  status: "ok",
  mode: NODE_ENV,
  time: new Date().toISOString()
}));

app.get("/api/v1/meta", auth, (_req, res) => res.json({
  service: "ENEXUR Growth OS",
  version: "0.1.0-foundation",
  states: WORKFLOW_STATES,
  specialists: Object.entries({
    prospect_intelligence: "Company discovery, contact verification, deduplication and fit scoring",
    sales_relationship: "Evidence-backed sales preparation and qualification",
    commercial_operations: "Proposal, order, payment and contract gates",
    intelligence_production: "Product-specific research and intelligence production",
    quality_assurance: "Independent evidence and deliverable validation",
    client_success_delivery: "Milestones, client updates, CEO review and controlled delivery"
  }).map(([id, purpose]) => ({ id, purpose })),
  integrations: { crm: "not_connected_by_this_service", prospecting: "not_connected_by_this_service", payments: "not_connected_by_this_service", e_signature: "not_connected_by_this_service" }
}));

app.get("/api/v1/workflows", auth, async (req, res) => {
  try {
    const items = await listWorkflows({ state: req.query.state, limit: req.query.limit });
    res.json({ count: items.length, items });
  } catch (error) { handleError(res, error); }
});

app.post("/api/v1/workflows", auth, async (req, res) => {
  try {
    const id = req.body?.id || makeId();
    const workflow = createWorkflow({ ...req.body, id }, req.actor);
    const event = buildAuditEvent({ workflowId: id, action: "WORKFLOW_CREATED", actor: req.actor, toState: workflow.state, details: { companyName: workflow.companyName } });
    await insertWorkflow(workflow, { ...event, eventId: randomUUID() });
    res.status(201).json({ item: workflow, nextSpecialist: routeSpecialist(workflow.state) });
  } catch (error) { handleError(res, error); }
});

app.get("/api/v1/workflows/:id", auth, async (req, res) => {
  try {
    const item = await getWorkflow(req.params.id);
    if (!item) return res.status(404).json({ error: "WORKFLOW_NOT_FOUND" });
    res.json({ item, nextSpecialist: routeSpecialist(item.state) });
  } catch (error) { handleError(res, error); }
});

app.post("/api/v1/workflows/:id/transition", auth, async (req, res) => {
  try {
    const current = await getWorkflow(req.params.id);
    if (!current) return res.status(404).json({ error: "WORKFLOW_NOT_FOUND" });
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion !== current.version) {
      return res.status(409).json({ error: "VERSION_CONFLICT", currentVersion: current.version });
    }
    const next = transitionWorkflow(current, req.body?.toState, req.actor, req.body?.evidence || {});
    const event = buildAuditEvent({
      workflowId: current.id, action: "WORKFLOW_TRANSITION", actor: req.actor,
      fromState: current.state, toState: next.state,
      details: { evidence: req.body?.evidence || {}, requestId: randomUUID() }
    });
    await updateWorkflowAndAudit(next, { ...event, eventId: randomUUID() }, expectedVersion);
    res.json({ item: next, nextSpecialist: routeSpecialist(next.state) });
  } catch (error) { handleError(res, error); }
});

app.get("/api/v1/workflows/:id/audit", auth, async (req, res) => {
  try {
    const item = await getWorkflow(req.params.id);
    if (!item) return res.status(404).json({ error: "WORKFLOW_NOT_FOUND" });
    const events = await listAuditEvents(req.params.id, req.query.limit);
    res.json({ workflowId: req.params.id, count: events.length, events });
  } catch (error) { handleError(res, error); }
});

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && "body" in error) return res.status(400).json({ error: "INVALID_JSON" });
  return res.status(500).json({ error: "INTERNAL_ERROR" });
});

let server;
connectStore().then((storeInfo) => {
  console.log("ENEXUR Growth OS store:", JSON.stringify(storeInfo));
  server = app.listen(PORT, () => console.log(`ENEXUR Growth OS API listening on ${PORT}`));
}).catch((error) => {
  console.error("Failed to initialize store:", error.message);
  process.exitCode = 1;
});

async function shutdown() {
  if (server) await new Promise((resolve) => server.close(resolve));
  await closeStore();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export { app };
