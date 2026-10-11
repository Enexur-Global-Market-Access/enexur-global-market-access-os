import { MongoClient, ObjectId } from "mongodb";

let client;
let db;

export async function connectStore() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn("MONGODB_URI is not set. API will run in explicit in-memory development mode.");
    return { mode: "memory" };
  }
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  db = client.db(process.env.MONGODB_DB || "enexur_growth_os");
  await Promise.all([
    db.collection("workflows").createIndex({ id: 1 }, { unique: true }),
    db.collection("workflows").createIndex({ state: 1, updatedAt: -1 }),
    db.collection("audit_events").createIndex({ workflowId: 1, createdAt: -1 }),
    db.collection("audit_events").createIndex({ eventId: 1 }, { unique: true })
  ]);
  return { mode: "mongodb", database: db.databaseName };
}

const memory = { workflows: new Map(), audit_events: [] };

export function makeId() {
  return new ObjectId().toHexString();
}

export async function listWorkflows({ state, limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  if (!db) {
    return [...memory.workflows.values()]
      .filter((item) => !state || item.state === state)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, safeLimit);
  }
  return db.collection("workflows").find(state ? { state } : {}).sort({ updatedAt: -1 }).limit(safeLimit).toArray();
}

export async function getWorkflow(id) {
  if (!db) return memory.workflows.get(id) ?? null;
  return db.collection("workflows").findOne({ id });
}

export async function insertWorkflow(workflow, event) {
  if (!db) {
    if (memory.workflows.has(workflow.id)) throw new Error("DUPLICATE_WORKFLOW_ID");
    memory.workflows.set(workflow.id, workflow);
    memory.audit_events.push(event);
    return workflow;
  }
  await db.collection("workflows").insertOne(workflow);
  await db.collection("audit_events").insertOne(event);
  return workflow;
}

export async function updateWorkflowAndAudit(workflow, event, expectedVersion) {
  if (!db) {
    const current = memory.workflows.get(workflow.id);
    if (!current) throw new Error("WORKFLOW_NOT_FOUND");
    if (current.version !== expectedVersion) throw new Error("VERSION_CONFLICT");
    memory.workflows.set(workflow.id, workflow);
    memory.audit_events.push(event);
    return workflow;
  }
  const result = await db.collection("workflows").replaceOne(
    { id: workflow.id, version: expectedVersion }, workflow
  );
  if (result.modifiedCount !== 1) throw new Error("VERSION_CONFLICT");
  await db.collection("audit_events").insertOne(event);
  return workflow;
}

export async function listAuditEvents(workflowId, limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  if (!db) return memory.audit_events.filter((event) => !workflowId || event.workflowId === workflowId).slice(-safeLimit).reverse();
  return db.collection("audit_events").find(workflowId ? { workflowId } : {}).sort({ createdAt: -1 }).limit(safeLimit).toArray();
}

export async function closeStore() {
  if (client) await client.close();
  client = undefined;
  db = undefined;
}
