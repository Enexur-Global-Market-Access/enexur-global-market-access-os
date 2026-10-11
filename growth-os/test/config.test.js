import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const loadJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

test("product catalogue uses unique product codes and explicit launch controls", async () => {
  const catalogue = await loadJson("../config/product-catalog.json");
  const codes = catalogue.products.map((product) => product.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(catalogue.products.every((product) => product.name && product.status && typeof product.proposalAllowed === "boolean"));
  assert.equal(catalogue.products.find((product) => product.code === "INDIA_MARKET_ENTRY_SCORE").price.amount, 0);
  assert.equal(catalogue.products.find((product) => product.code === "INDIA_MARKET_INTELLIGENCE_FLAGSHIP").price.amount, 7500);
  assert.equal(catalogue.products.find((product) => product.code === "INDIA_PARTNER_DISCOVERY_CORE").price.amount, 18500);
  assert.equal(catalogue.products.find((product) => product.code === "INDIA_MARKET_ENTRY_PROGRAMME").proposalAllowed, false);
});

test("merged acquisition workflow preserves prospect acquisition fallback", async () => {
  const workflow = await loadJson("../config/acquisition-orchestration.json");
  assert.equal(workflow.workflowId, "ENEXUR_ACQUISITION_EXECUTOR");
  assert.ok(workflow.replaces.includes("4 Hour Distribution Execution Brief"));
  assert.ok(workflow.replaces.includes("4 Hour Executor Brief"));
  assert.ok(workflow.stages.some((stage) => stage.id === "fallback_acquisition_export" && stage.required === true));
  assert.equal(workflow.status, "defined_not_yet_scheduled");
  assert.equal(workflow.safety.externalOutreachDisabledUntilIntegrationsAndApprovalsAreConfigured, true);
});

test("agent registry has one orchestrator and six bounded specialists", async () => {
  const registry = await loadJson("../config/agent-registry.json");
  assert.equal(registry.orchestrator.id, "revenue_intelligence_orchestrator");
  assert.equal(registry.specialists.length, 6);
  assert.equal(new Set(registry.specialists.map((agent) => agent.id)).size, 6);
  assert.equal(registry.defaultPolicy.externalSideEffectsDisabledUntilProviderAndApprovalChecksPass, true);
});
