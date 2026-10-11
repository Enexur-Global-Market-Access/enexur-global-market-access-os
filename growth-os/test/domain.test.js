import test from "node:test";
import assert from "node:assert/strict";
import { createWorkflow, routeSpecialist, transitionWorkflow } from "../src/domain.js";

const agent = { id: "test-agent", role: "agent" };
const ceo = { id: "test-ceo", role: "ceo" };
const finance = { id: "test-finance", role: "finance" };

function workflow(state = "DISCOVERED") {
  return { ...createWorkflow({ id: "wf-test", companyName: "Example Industrial Ltd" }, agent), state, version: 0 };
}

test("creates a prospect workflow and routes it to prospect intelligence", () => {
  const item = workflow();
  assert.equal(item.state, "DISCOVERED");
  assert.equal(routeSpecialist(item.state), "prospect_intelligence");
});

test("requires verified contact evidence before contactable", () => {
  const researched = { ...workflow(), state: "RESEARCHED" };
  assert.throws(() => transitionWorkflow(researched, "CONTACTABLE", agent, {}), /VERIFIED_CONTACT_REQUIRED/);
  assert.equal(transitionWorkflow(researched, "CONTACTABLE", agent, { contactVerified: true }).state, "CONTACTABLE");
});

test("outreach requires CEO approval, approved reference, permitted channel and no suppression", () => {
  const item = { ...workflow(), state: "CONTACTABLE" };
  const approvedEvidence = { outreachApproved: true, channelAuthorized: true, approvalReference: "campaign-approval-2026-01" };
  assert.throws(() => transitionWorkflow(item, "APPROVED_FOR_OUTREACH", agent, approvedEvidence), /CEO_APPROVAL_REQUIRED/);
  assert.throws(() => transitionWorkflow(item, "APPROVED_FOR_OUTREACH", ceo, { ...approvedEvidence, optedOut: true }), /CONTACT_SUPPRESSED/);
  assert.throws(() => transitionWorkflow(item, "APPROVED_FOR_OUTREACH", ceo, { outreachApproved: true, channelAuthorized: true }), /OUTREACH_APPROVAL_REFERENCE_REQUIRED/);
  assert.equal(transitionWorkflow(item, "APPROVED_FOR_OUTREACH", ceo, approvedEvidence).state, "APPROVED_FOR_OUTREACH");
});

test("qualified opportunity requires recorded need, stakeholder and next step", () => {
  assert.throws(() => transitionWorkflow({ ...workflow(), state: "DISCOVERY" }, "QUALIFIED_OPPORTUNITY", agent, {}), /QUALIFICATION_EVIDENCE_INCOMPLETE/);
});

test("order acceptance requires CEO commercial approval", () => {
  const proposal = { ...workflow(), state: "PROPOSAL" };
  assert.throws(() => transitionWorkflow(proposal, "ORDER_ACCEPTED", agent, { commercialApproved: true }), /CEO_APPROVAL_REQUIRED/);
  assert.throws(() => transitionWorkflow(proposal, "ORDER_ACCEPTED", ceo, {}), /COMMERCIAL_APPROVAL_REQUIRED/);
  assert.equal(transitionWorkflow(proposal, "ORDER_ACCEPTED", ceo, { commercialApproved: true }).state, "ORDER_ACCEPTED");
});

test("payment receipt alone is not payment verification", () => {
  const pending = { ...workflow(), state: "PAYMENT_PENDING" };
  assert.throws(() => transitionWorkflow(pending, "PAID", agent, { receiptUploaded: true }), /PAYMENT_NOT_VERIFIED/);
  assert.throws(() => transitionWorkflow(pending, "PAID", agent, { paymentProviderVerified: true, paymentProviderReference: "txn-123" }), /PAYMENT_NOT_VERIFIED/);
  assert.throws(() => transitionWorkflow(pending, "PAID", finance, { paymentProviderVerified: true }), /PAYMENT_NOT_VERIFIED/);
  assert.equal(transitionWorkflow(pending, "PAID", finance, { paymentProviderVerified: true, paymentProviderReference: "txn-123" }).state, "PAID");
});

test("contracted state requires an executed contract reference and CEO role", () => {
  const pending = { ...workflow(), state: "CONTRACT_PENDING" };
  assert.throws(() => transitionWorkflow(pending, "CONTRACTED", agent, { contractExecuted: true, contractReference: "contract-123" }), /CEO_APPROVAL_REQUIRED/);
  assert.throws(() => transitionWorkflow(pending, "CONTRACTED", ceo, { contractExecuted: true }), /EXECUTED_CONTRACT_REQUIRED/);
  assert.equal(transitionWorkflow(pending, "CONTRACTED", ceo, { contractExecuted: true, contractReference: "contract-123" }).state, "CONTRACTED");
});

test("only CEO can approve release and QA must pass", () => {
  const item = { ...workflow(), state: "CEO_REVIEW" };
  const evidence = { ceoDecision: "APPROVE", qaPassed: true, criticalDefects: 0 };
  assert.throws(() => transitionWorkflow(item, "APPROVED_FOR_RELEASE", agent, evidence), /CEO_APPROVAL_REQUIRED/);
  assert.throws(() => transitionWorkflow(item, "APPROVED_FOR_RELEASE", ceo, { ...evidence, qaPassed: false }), /CEO_RELEASE_APPROVAL_AND_QA_REQUIRED/);
  assert.equal(transitionWorkflow(item, "APPROVED_FOR_RELEASE", ceo, evidence).state, "APPROVED_FOR_RELEASE");
});

test("QA critical defects block CEO review", () => {
  assert.throws(() => transitionWorkflow({ ...workflow(), state: "QA" }, "CEO_REVIEW", agent, { qaPassed: true, criticalDefects: 1 }), /QA_RELEASE_GATE_FAILED/);
});

test("final delivery requires prior release approval", () => {
  assert.throws(() => transitionWorkflow({ ...workflow(), state: "APPROVED_FOR_RELEASE" }, "DELIVERED", ceo, {}), /APPROVED_RELEASE_REQUIRED/);
});

test("workflow version increments on valid transition", () => {
  const next = transitionWorkflow(workflow(), "RESEARCHED", agent);
  assert.equal(next.version, 1);
  assert.equal(next.state, "RESEARCHED");
});
