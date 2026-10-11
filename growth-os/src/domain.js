export const WORKFLOW_STATES = Object.freeze([
  "DISCOVERED", "RESEARCHED", "CONTACTABLE", "APPROVED_FOR_OUTREACH",
  "CONTACTED", "ENGAGED", "DISCOVERY", "QUALIFIED_OPPORTUNITY", "PROPOSAL",
  "COMMERCIAL_APPROVAL", "ORDER_ACCEPTED", "PAYMENT_PENDING", "PAID",
  "CONTRACT_PENDING", "CONTRACTED", "ONBOARDING", "IN_PRODUCTION", "QA",
  "CEO_REVIEW", "REVISION_REQUIRED", "APPROVED_FOR_RELEASE", "DELIVERED",
  "CLOSED", "LOST", "BLOCKED"
]);

export const SPECIALISTS = Object.freeze({
  prospect_intelligence: { purpose: "Company discovery, contact verification, deduplication and fit scoring", sideEffects: "internal_only" },
  sales_relationship: { purpose: "Account research, approved outreach drafts, conversation classification and qualification", sideEffects: "draft_only_until_channel_authorized" },
  commercial_operations: { purpose: "Proposal/SOW preparation, order records, payment reconciliation and contract preparation", sideEffects: "payment_and_contract_gated" },
  intelligence_production: { purpose: "Evidence-led research, analysis, models, reports and project artifacts", sideEffects: "internal_only" },
  quality_assurance: { purpose: "Independent source, calculation, scope and deliverable QA", sideEffects: "cannot_approve_own_critical_defects" },
  client_success_delivery: { purpose: "Milestones, client status drafts, revisions and approved delivery", sideEffects: "final_release_gated" }
});

const TRANSITIONS = {
  DISCOVERED: ["RESEARCHED", "BLOCKED", "LOST"],
  RESEARCHED: ["CONTACTABLE", "BLOCKED", "LOST"],
  CONTACTABLE: ["APPROVED_FOR_OUTREACH", "BLOCKED", "LOST"],
  APPROVED_FOR_OUTREACH: ["CONTACTED", "BLOCKED", "LOST"],
  CONTACTED: ["ENGAGED", "LOST", "BLOCKED"],
  ENGAGED: ["DISCOVERY", "QUALIFIED_OPPORTUNITY", "LOST", "BLOCKED"],
  DISCOVERY: ["QUALIFIED_OPPORTUNITY", "ENGAGED", "LOST", "BLOCKED"],
  QUALIFIED_OPPORTUNITY: ["PROPOSAL", "LOST", "BLOCKED"],
  PROPOSAL: ["COMMERCIAL_APPROVAL", "ORDER_ACCEPTED", "QUALIFIED_OPPORTUNITY", "LOST", "BLOCKED"],
  COMMERCIAL_APPROVAL: ["PROPOSAL", "ORDER_ACCEPTED", "BLOCKED"],
  ORDER_ACCEPTED: ["PAYMENT_PENDING", "CONTRACT_PENDING", "BLOCKED"],
  PAYMENT_PENDING: ["PAID", "ORDER_ACCEPTED", "BLOCKED", "LOST"],
  PAID: ["CONTRACT_PENDING", "CONTRACTED", "BLOCKED"],
  CONTRACT_PENDING: ["CONTRACTED", "BLOCKED"],
  CONTRACTED: ["ONBOARDING", "BLOCKED"],
  ONBOARDING: ["IN_PRODUCTION", "BLOCKED"],
  IN_PRODUCTION: ["QA", "BLOCKED"],
  QA: ["IN_PRODUCTION", "CEO_REVIEW", "BLOCKED"],
  CEO_REVIEW: ["REVISION_REQUIRED", "APPROVED_FOR_RELEASE", "BLOCKED"],
  REVISION_REQUIRED: ["IN_PRODUCTION", "QA", "CEO_REVIEW", "BLOCKED"],
  APPROVED_FOR_RELEASE: ["DELIVERED", "BLOCKED"],
  DELIVERED: ["CLOSED", "REVISION_REQUIRED", "BLOCKED"],
  CLOSED: [], LOST: [], BLOCKED: ["RESEARCHED", "CONTACTABLE", "IN_PRODUCTION", "QA"]
};

const CEO_ONLY_TARGETS = new Set(["APPROVED_FOR_OUTREACH", "ORDER_ACCEPTED", "CONTRACTED", "APPROVED_FOR_RELEASE"]);
const CEO_ROLES = new Set(["ceo", "admin"]);
const FINANCE_ROLES = new Set(["ceo", "admin", "finance"]);
const TERMINAL_STATES = new Set(["CLOSED", "LOST"]);

export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}

export function transitionWorkflow(workflow, toState, actor, evidence = {}) {
  if (!workflow || !WORKFLOW_STATES.includes(workflow.state)) {
    throw new Error("WORKFLOW_NOT_FOUND_OR_INVALID");
  }
  if (!WORKFLOW_STATES.includes(toState) || !canTransition(workflow.state, toState)) {
    throw new Error(`INVALID_TRANSITION:${workflow.state}->${toState}`);
  }
  if (TERMINAL_STATES.has(workflow.state)) throw new Error("WORKFLOW_TERMINAL");
  if (CEO_ONLY_TARGETS.has(toState) && !CEO_ROLES.has(actor?.role)) {
    throw new Error("CEO_APPROVAL_REQUIRED");
  }
  if (toState === "CONTACTABLE" && evidence.contactVerified !== true) {
    throw new Error("VERIFIED_CONTACT_REQUIRED");
  }
  if (toState === "APPROVED_FOR_OUTREACH") {
    if (evidence.outreachApproved !== true) throw new Error("OUTREACH_APPROVAL_REQUIRED");
    if (evidence.optedOut === true || evidence.suppressed === true) throw new Error("CONTACT_SUPPRESSED");
    if (evidence.channelAuthorized !== true) throw new Error("AUTHORIZED_CHANNEL_REQUIRED");
    if (typeof evidence.approvalReference !== "string" || !evidence.approvalReference.trim()) {
      throw new Error("OUTREACH_APPROVAL_REFERENCE_REQUIRED");
    }
  }
  if (toState === "QUALIFIED_OPPORTUNITY") {
    const required = ["needConfirmed", "stakeholderIdentified", "nextStepRecorded"];
    if (required.some((key) => evidence[key] !== true)) throw new Error("QUALIFICATION_EVIDENCE_INCOMPLETE");
  }
  if (toState === "ORDER_ACCEPTED" && evidence.commercialApproved !== true) {
    throw new Error("COMMERCIAL_APPROVAL_REQUIRED");
  }
  if (toState === "PAID") {
    if (!FINANCE_ROLES.has(actor?.role) || evidence.paymentProviderVerified !== true ||
        typeof evidence.paymentProviderReference !== "string" || !evidence.paymentProviderReference.trim()) {
      throw new Error("PAYMENT_NOT_VERIFIED");
    }
  }
  if (toState === "CONTRACTED" && (evidence.contractExecuted !== true ||
      typeof evidence.contractReference !== "string" || !evidence.contractReference.trim())) {
    throw new Error("EXECUTED_CONTRACT_REQUIRED");
  }
  if (toState === "IN_PRODUCTION" && evidence.kickoffPrerequisitesMet !== true) {
    throw new Error("ENGAGEMENT_KICKOFF_PREREQUISITES_REQUIRED");
  }
  if (toState === "QA" && evidence.mandatoryDeliverablesComplete !== true) {
    throw new Error("MANDATORY_DELIVERABLES_INCOMPLETE");
  }
  if (toState === "CEO_REVIEW") {
    if (evidence.qaPassed !== true || evidence.criticalDefects > 0) {
      throw new Error("QA_RELEASE_GATE_FAILED");
    }
  }
  if (toState === "APPROVED_FOR_RELEASE") {
    if (evidence.ceoDecision !== "APPROVE" || evidence.qaPassed !== true || evidence.criticalDefects > 0) {
      throw new Error("CEO_RELEASE_APPROVAL_AND_QA_REQUIRED");
    }
  }
  if (toState === "DELIVERED" && evidence.releaseApproved !== true) {
    throw new Error("APPROVED_RELEASE_REQUIRED");
  }
  return {
    ...workflow,
    state: toState,
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.id ?? "system",
    version: (workflow.version ?? 0) + 1
  };
}

export function createWorkflow(input, actor) {
  if (!input?.companyName || typeof input.companyName !== "string") {
    throw new Error("COMPANY_NAME_REQUIRED");
  }
  return {
    id: input.id,
    companyName: input.companyName.trim(),
    contactId: input.contactId ?? null,
    opportunityId: input.opportunityId ?? null,
    productCode: input.productCode ?? null,
    productVersion: input.productVersion ?? null,
    state: "DISCOVERED",
    revenue: { currency: input.currency ?? "USD", amount: null, collectedAmount: 0 },
    evidenceRefs: [],
    nextAction: "Research company and identify a relevant business need",
    assignedSpecialist: "prospect_intelligence",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: actor?.id ?? "system",
    updatedBy: actor?.id ?? "system",
    version: 0
  };
}

export function routeSpecialist(state) {
  if (["DISCOVERED", "RESEARCHED", "CONTACTABLE"].includes(state)) return "prospect_intelligence";
  if (["APPROVED_FOR_OUTREACH", "CONTACTED", "ENGAGED", "DISCOVERY", "QUALIFIED_OPPORTUNITY"].includes(state)) return "sales_relationship";
  if (["PROPOSAL", "COMMERCIAL_APPROVAL", "ORDER_ACCEPTED", "PAYMENT_PENDING", "PAID", "CONTRACT_PENDING", "CONTRACTED"].includes(state)) return "commercial_operations";
  if (["ONBOARDING", "IN_PRODUCTION"].includes(state)) return "intelligence_production";
  if (state === "QA") return "quality_assurance";
  if (["CEO_REVIEW", "REVISION_REQUIRED", "APPROVED_FOR_RELEASE", "DELIVERED", "CLOSED"].includes(state)) return "client_success_delivery";
  return null;
}

export function buildAuditEvent({ workflowId, action, actor, fromState = null, toState = null, details = {} }) {
  return {
    workflowId, action, actorId: actor?.id ?? "system", actorRole: actor?.role ?? "system",
    fromState, toState, details, createdAt: new Date().toISOString()
  };
}
