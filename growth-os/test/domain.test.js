import test from "node:test";
import assert from "node:assert/strict";
import { createWorkflow, routeSpecialist, transitionWorkflow } from "../src/domain.js";

const agent = { id: "test-agent", role: "agent" };
const ceo = { id: "test-ceo", role: "ceo" };

function workflow(state = "DISCOVERED") {
  return { ...createWorkflow({ id: "wf-test", companyName: "Example Industrial Ltd" }, agent), state, version: 0 };
}

test("creates a prospect workflow and routes it to prospect intelligence", () => {
  const item = workflow();
  assert.equal(item.state, "DISCOVERED");
  assert.equal(routeSpecialist(item.state), "prospect_intelligence");
});

test("rejects contactable stage without verified contact evidence", () => {
  assert.throws(() => transitionWorkflow(workflow(), "RESEARCHED", agent), /INVALID_TRANSITION/);
  assert.throws(() => transitionWorkflow({ ...workflow(), state: "RESEARCHED" }, "CONTACTABLE", agent, {}), /VERIFIED_CONTACT_REQUIRED/);
});

test("outreach requires approval, permitted channel and no suppression", () => {
  const item = { ...workflow(), state: "CONTACTABLE" };
  assert.throws(() => transitionWorkflow(item, "APPROVED_FOR_OUTREACH", agent, { outreachApproved: true, channelAuthorized: true }), /OUTREACH_APPROVAL_REQUIRED/);
  assert.throws(() => transitionWorkflow(item, "APPROVED_FOR_OUTREACH", agent, { outreachApproved: true, channelAuthorized: true, optedOut: true }), /CONTACT_SUPPRESSED/);
  assert.equal(transitionWorkflow(item, "APPROVED_FOR_OUTREACH", agent, { outreachApproved: true, channelAuthorized: true }).state, "APPROVED_FOR_OUTREACH");
});

test("qualified opportunity requires recorded need, stakeholder and next step", () => {
  assert.throws(() => transitionWorkflow({ ...workflow(), state: "DISCOVERY" }, "QUALIFIED_OPPORTUNITY", agent, {}), /QUALIFICATION_EVIDENCE_INCOMPLETE/);
});

test("order acceptance requires commercial approval", () => {
  assert.throws(() => transitionWorkflow({ ...workflow(), state: "PROPOSAL" }, "ORDER_ACCEPTED", agent, {}), /COMMERCIAL_APPROVAL_REQUIRED/);
  assert.equal(transitionWorkflow({ ...workflow(), state: "PROPOSAL" }, "ORDER_ACCEPTED", agent, { commercialApproved: true }).state, "ORDER_ACCEPTED");
});

test("payment screenshot is not accepted as payment verification", () => {
  assert.throws(() => transitionWorkflow({ ...workflow(), state: "PAYMENT_PENDING" }, "PAID", agent, { receiptUploaded: true }), /PAYMENT_NOT_VERIFIED/);
  assert.equal(transitionWorkflow({ ...workflow(), state: "PAYMENT_PENDING" }, "PAID", agent, { paymentProviderVerified: true }).state, "PAID");
});

test("only CEO can approve release", () => {
  const item = { ...workflow(), state: "CEO_REVIEW" };
  const evidence = { ceoDecision: "APPROVE", qaPassed: true, criticalDefects: 0 };
  assert.throws(() => transitionWorkflow(item, "APPROVED_FOR_RELEASE", agent, evidence), /CEO_APPROVAL_REQUIRED/);
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
