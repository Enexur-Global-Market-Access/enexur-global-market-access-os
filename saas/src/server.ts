import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { PrismaClient, type Role } from '@prisma/client';
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';

const scrypt = promisify(scryptCb);
export const prisma = new PrismaClient();
const cookieName = process.env.SESSION_COOKIE_NAME || 'enexur_session';
const ttlDays = Number(process.env.SESSION_TTL_DAYS || 14);
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const passwordHash = async (password: string) => {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${key.toString('hex')}`;
};
const passwordMatches = async (password: string, stored: string) => {
  const [, salt, keyHex] = stored.split('$');
  if (!salt || !keyHex) return false;
  const actual = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(keyHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

declare module 'fastify' {
  interface FastifyRequest { auth?: { userId: string; workspaceId: string; role: Role; name: string; email: string } }
}

export const app = Fastify({ logger: true, trustProxy: process.env.NODE_ENV === 'production', bodyLimit: 1_000_000 });
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cookie);
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

const authRequired = async (req: FastifyRequest, reply: FastifyReply) => {
  const raw = req.cookies[cookieName];
  if (!raw) return reply.code(401).send({ error: 'AUTH_REQUIRED' });
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(raw) }, include: { user: { include: { memberships: { include: { workspace: true } } } } } });
  if (!session || session.expiresAt <= new Date()) {
    if (session) await prisma.session.delete({ where: { id: session.id } });
    return reply.code(401).send({ error: 'SESSION_EXPIRED' });
  }
  const membership = session.user.memberships[0];
  if (!membership) return reply.code(403).send({ error: 'WORKSPACE_MEMBERSHIP_REQUIRED' });
  req.auth = { userId: session.userId, workspaceId: membership.workspaceId, role: membership.role, name: session.user.name, email: session.user.email };
};

const permissions: Record<Role, string[]> = {
  CLIENT_ADMIN: ['view','create','edit','delete','export','approve','send','manage_users','manage_billing','manage_integrations','manage_AI','manage_workspace'],
  CLIENT_EXECUTIVE: ['view','create','edit','export','approve','send'],
  CLIENT_ANALYST: ['view','create','edit','export'],
  CLIENT_SALES: ['view','create','edit','send'],
  CLIENT_VIEWER: ['view'],
  ENEXUR_ADMIN: ['view','create','edit','delete','export','approve','send','manage_users','manage_billing','manage_integrations','manage_AI','manage_workspace','administer_platform'],
  ENEXUR_ANALYST: ['view','create','edit','export'], ENEXUR_SALES: ['view','create','edit','send'],
  ENEXUR_OPERATIONS: ['view','create','edit','approve'], ENEXUR_PARTNER: ['view','create']
};
const can = (req: FastifyRequest, permission: string) => !!req.auth && permissions[req.auth.role].includes(permission);
const requirePermission = (permission: string) => async (req: FastifyRequest, reply: FastifyReply) => {
  await authRequired(req, reply);
  if (!reply.sent && !can(req, permission)) return reply.code(403).send({ error: 'FORBIDDEN', required: permission });
};
const csrf = async (req: FastifyRequest, reply: FastifyReply) => {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return;
  const origin = req.headers.origin;
  const configured = process.env.WEB_ORIGIN;
  if (origin && configured && new URL(origin).origin !== new URL(configured).origin) return reply.code(403).send({ error: 'ORIGIN_REJECTED' });
  const cookieToken = req.cookies.enexur_csrf;
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) return reply.code(403).send({ error: 'CSRF_TOKEN_REQUIRED' });
};
app.addHook('preHandler', csrf);

const emailSchema = z.string().trim().email().max(254).transform(v => v.toLowerCase());
const registerSchema = z.object({ name: z.string().trim().min(2).max(100), email: emailSchema, password: z.string().min(12).max(128), organizationName: z.string().trim().min(2).max(120) });
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
const companySchema = z.object({ name: z.string().trim().min(2).max(180), country: z.string().trim().max(80).optional(), sector: z.string().trim().max(100).optional(), website: z.string().trim().url().max(300).optional(), notes: z.string().max(3000).optional() });
const opportunitySchema = z.object({ name: z.string().trim().min(2).max(180), companyId: z.string().uuid().optional(), stage: z.enum(['DISCOVERY','QUALIFIED','PROPOSAL','NEGOTIATION','CONFIRMED','EXECUTION','CLOSED_WON','CLOSED_LOST']).optional(), value: z.coerce.number().min(0).max(1_000_000_000).optional(), currency: z.string().length(3).toUpperCase().optional(), closeDate: z.coerce.date().optional() });
const assessmentSchema = z.object({ companyName: z.string().trim().max(180).optional(), answers: z.record(z.string(), z.union([z.string(),z.number(),z.boolean(),z.array(z.string())])).default({}) });
export const assessmentDimensions = [
  'Market Relevance','Product-Market Fit','Customer Segment Clarity','Competitive Understanding','Pricing Readiness',
  'Channel Readiness','Regulatory Readiness','Local Representation','Sourcing Opportunity','Digital Readiness',
  'Budget Availability','Executive Sponsorship','Timeline','Decision-Maker Involvement','Execution Readiness'
] as const;
export function calculateAssessment(answers: Record<string, unknown>) {
  const dimensions = assessmentDimensions.map((name, index) => {
    const raw = answers[String(index + 1)] ?? answers[name];
    const value = typeof raw === 'object' && raw !== null && 'answer' in raw ? (raw as {answer:unknown}).answer : raw;
    const normalized = typeof value === 'string' ? value.toUpperCase() : value === true ? 'YES' : value === false ? 'NO' : '';
    const score = normalized === 'YES' || normalized === 'EVIDENCE' ? 100 : normalized === 'NOT SURE' ? 50 : normalized === 'NO' ? 0 : null;
    return { name, score, answer: normalized || 'UNANSWERED' };
  });
  const answered = dimensions.filter(d => d.score !== null);
  const score = answered.length ? Math.round(answered.reduce((sum, d) => sum + (d.score || 0), 0) / answered.length) : null;
  const strengths = dimensions.filter(d => d.score === 100).map(d => d.name);
  const gaps = dimensions.filter(d => d.score === 0).map(d => d.name);
  const risks = dimensions.filter(d => d.score === 50).map(d => d.name);
  const recommendedActions = [...gaps.slice(0, 3).map(d => `Build an evidence-backed plan for ${d.toLowerCase()}.`), ...risks.slice(0, 2).map(d => `Validate assumptions around ${d.toLowerCase()}.`)];
  const nextProduct = score === null ? 'Complete the assessment' : score >= 75 ? 'India Market Entry Diagnostic' : 'Market Readiness Advisory';
  return { score, dimensions, strengths, gaps, risks, recommendedActions, nextProduct, answered: answered.length };
}

app.get('/api/health', async (_req, reply) => {
  let database: 'ok'|'unavailable' = 'ok';
  try { await prisma.$queryRaw`SELECT 1`; } catch { database = 'unavailable'; }
  return reply.code(database === 'ok' ? 200 : 503).send({ status: database === 'ok' ? 'ok' : 'degraded', database, queue: 'not_configured', timestamp: new Date().toISOString() });
});
app.get('/api/auth/csrf', async (_req, reply) => {
  const token = randomBytes(24).toString('hex');
  reply.setCookie('enexur_csrf', token, { httpOnly: false, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: 3600 });
  return { csrfToken: token };
});
app.post('/api/auth/register', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
  const { name, email, password, organizationName } = parsed.data;
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return reply.code(409).send({ error: 'EMAIL_ALREADY_REGISTERED' });
  const user = await prisma.$transaction(async tx => {
    const created = await tx.user.create({ data: { name, email, passwordHash: await passwordHash(password) } });
    const organization = await tx.organization.create({ data: { name: organizationName } });
    const workspace = await tx.workspace.create({ data: { name: `${organizationName} workspace`, organizationId: organization.id } });
    await tx.workspaceMember.create({ data: { userId: created.id, workspaceId: workspace.id, role: 'CLIENT_ADMIN' } });
    await tx.auditLog.create({ data: { workspaceId: workspace.id, actorId: created.id, action: 'workspace.created', entity: 'workspace', entityId: workspace.id } });
    return { ...created, workspace };
  });
  const raw = randomBytes(32).toString('base64url');
  await prisma.session.create({ data: { tokenHash: hashToken(raw), userId: user.id, expiresAt: new Date(Date.now() + ttlDays * 86400000) } });
  reply.setCookie(cookieName, raw, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: ttlDays * 86400 });
  return reply.code(201).send({ user: { id: user.id, name: user.name, email: user.email }, workspace: { id: user.workspace.id, name: user.workspace.name } });
});
app.post('/api/auth/login', { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } }, async (req, reply) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, include: { memberships: { include: { workspace: true } } } });
  if (!user || !await passwordMatches(parsed.data.password, user.passwordHash)) return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
  const membership = user.memberships[0];
  if (!membership) return reply.code(403).send({ error: 'WORKSPACE_MEMBERSHIP_REQUIRED' });
  const raw = randomBytes(32).toString('base64url');
  await prisma.session.create({ data: { tokenHash: hashToken(raw), userId: user.id, expiresAt: new Date(Date.now() + ttlDays * 86400000) } });
  reply.setCookie(cookieName, raw, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: ttlDays * 86400 });
  return { user: { id: user.id, name: user.name, email: user.email }, workspace: { id: membership.workspaceId, name: membership.workspace.name }, role: membership.role };
});
app.get('/api/auth/me', { preHandler: authRequired }, async req => ({ user: req.auth }));
app.post('/api/auth/logout', { preHandler: authRequired }, async (req, reply) => {
  const raw = req.cookies[cookieName];
  if (raw) await prisma.session.deleteMany({ where: { tokenHash: hashToken(raw) } });
  reply.clearCookie(cookieName, { path: '/' });
  reply.clearCookie('enexur_csrf', { path: '/' });
  return { ok: true };
});
app.get('/api/workspace', { preHandler: authRequired }, async req => ({ id: req.auth!.workspaceId, role: req.auth!.role }));
app.get('/api/companies', { preHandler: requirePermission('view') }, async req => prisma.company.findMany({ where: { workspaceId: req.auth!.workspaceId }, orderBy: { updatedAt: 'desc' }, take: 200 }));
app.post('/api/companies', { preHandler: requirePermission('create') }, async (req, reply) => {
  const parsed = companySchema.safeParse(req.body); if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
  const row = await prisma.company.create({ data: { ...parsed.data, workspaceId: req.auth!.workspaceId } });
  await prisma.auditLog.create({ data: { workspaceId: req.auth!.workspaceId, actorId: req.auth!.userId, action: 'company.created', entity: 'company', entityId: row.id } });
  return reply.code(201).send(row);
});
app.patch('/api/companies/:id', { preHandler: requirePermission('edit') }, async (req, reply) => {
  const parsed = companySchema.partial().safeParse(req.body); if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR' });
  const { id } = req.params as { id: string };
  const result = await prisma.company.updateMany({ where: { id, workspaceId: req.auth!.workspaceId }, data: parsed.data });
  if (!result.count) return reply.code(404).send({ error: 'NOT_FOUND' });
  await prisma.auditLog.create({ data: { workspaceId: req.auth!.workspaceId, actorId: req.auth!.userId, action: 'company.updated', entity: 'company', entityId: id } });
  return prisma.company.findFirst({ where: { id, workspaceId: req.auth!.workspaceId } });
});
app.delete('/api/companies/:id', { preHandler: requirePermission('delete') }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const result = await prisma.company.deleteMany({ where: { id, workspaceId: req.auth!.workspaceId } });
  if (!result.count) return reply.code(404).send({ error: 'NOT_FOUND' });
  return reply.code(204).send();
});
app.get('/api/opportunities', { preHandler: requirePermission('view') }, async req => prisma.opportunity.findMany({ where: { workspaceId: req.auth!.workspaceId }, include: { company: true }, orderBy: { updatedAt: 'desc' }, take: 200 }));
app.post('/api/opportunities', { preHandler: requirePermission('create') }, async (req, reply) => {
  const parsed = opportunitySchema.safeParse(req.body); if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
  if (parsed.data.companyId && !await prisma.company.findFirst({ where: { id: parsed.data.companyId, workspaceId: req.auth!.workspaceId } })) return reply.code(404).send({ error: 'COMPANY_NOT_FOUND' });
  const row = await prisma.opportunity.create({ data: { ...parsed.data, workspaceId: req.auth!.workspaceId, value: parsed.data.value, stage: parsed.data.stage } });
  await prisma.auditLog.create({ data: { workspaceId: req.auth!.workspaceId, actorId: req.auth!.userId, action: 'opportunity.created', entity: 'opportunity', entityId: row.id } });
  return reply.code(201).send(row);
});
app.patch('/api/opportunities/:id', { preHandler: requirePermission('edit') }, async (req, reply) => {
  const parsed = opportunitySchema.partial().safeParse(req.body); if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR' });
  const { id } = req.params as { id: string };
  if (parsed.data.companyId && !await prisma.company.findFirst({ where: { id: parsed.data.companyId, workspaceId: req.auth!.workspaceId } })) return reply.code(404).send({ error: 'COMPANY_NOT_FOUND' });
  const changed = await prisma.opportunity.updateMany({ where: { id, workspaceId: req.auth!.workspaceId }, data: parsed.data });
  if (!changed.count) return reply.code(404).send({ error: 'NOT_FOUND' });
  await prisma.auditLog.create({ data: { workspaceId: req.auth!.workspaceId, actorId: req.auth!.userId, action: 'opportunity.updated', entity: 'opportunity', entityId: id } });
  return prisma.opportunity.findFirst({ where: { id, workspaceId: req.auth!.workspaceId }, include: { company: true } });
});
app.get('/api/assessments', { preHandler: requirePermission('view') }, async req => prisma.assessment.findMany({ where: { workspaceId: req.auth!.workspaceId }, orderBy: { updatedAt: 'desc' }, take: 200 }));
app.post('/api/assessments', { preHandler: requirePermission('create') }, async (req, reply) => {
  const parsed = assessmentSchema.safeParse(req.body); if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
  const row = await prisma.assessment.create({ data: { workspaceId: req.auth!.workspaceId, companyName: parsed.data.companyName, answers: parsed.data.answers } });
  return reply.code(201).send(row);
});
app.post('/api/assessments/:id/submit', { preHandler: requirePermission('edit') }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const assessment = await prisma.assessment.findFirst({ where: { id, workspaceId: req.auth!.workspaceId } });
  if (!assessment) return reply.code(404).send({ error: 'NOT_FOUND' });
  if (assessment.status === 'SUBMITTED') return reply.code(409).send({ error: 'ALREADY_SUBMITTED' });
  const answerObject = assessment.answers as Record<string, unknown>;
  const result = calculateAssessment(answerObject);
  if (result.answered !== 15 || result.score === null) return reply.code(400).send({ error: 'ALL_15_DIMENSIONS_REQUIRED', answered: result.answered });
  const saved = await prisma.assessment.update({ where: { id }, data: { score: result.score, result, status: 'SUBMITTED', submittedAt: new Date() } });
  await prisma.auditLog.create({ data: { workspaceId: req.auth!.workspaceId, actorId: req.auth!.userId, action: 'assessment.submitted', entity: 'assessment', entityId: id, metadata: { score: result.score } } });
  return saved;
});
app.get('/api/audit-logs', { preHandler: requirePermission('view') }, async req => prisma.auditLog.findMany({ where: { workspaceId: req.auth!.workspaceId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id:true, action:true, entity:true, entityId:true, metadata:true, createdAt:true, actor:{select:{name:true,email:true}} } }));
app.get('/api/dashboard', { preHandler: requirePermission('view') }, async req => {
  const workspaceId = req.auth!.workspaceId;
  const period = (req.query as {period?:string}).period || 'all';
  const days:Record<string,number> = { '7d':7, '30d':30, '90d':90, 'year':365 };
  let since:Date|undefined = days[period] ? new Date(Date.now()-days[period]*86400000) : undefined;
  if (period === 'today') { since = new Date(); since.setHours(0,0,0,0); }
  if (period === 'quarter') { const now = new Date(); since = new Date(now.getFullYear(),Math.floor(now.getMonth()/3)*3,1); }
  const createdAt = since ? { gte: since } : undefined;
  const [companies, opportunities, assessments, tasks, grouped] = await Promise.all([
    prisma.company.count({ where: { workspaceId, createdAt } }),
    prisma.opportunity.findMany({ where: { workspaceId, createdAt }, select: { value: true, stage: true } }),
    prisma.assessment.count({ where: { workspaceId, status: 'SUBMITTED', submittedAt: createdAt } }),
    prisma.task.count({ where: { workspaceId, status: 'OPEN', createdAt } }),
    prisma.opportunity.groupBy({ by: ['stage'], where: { workspaceId, createdAt }, _count: true, _sum: { value: true } })
  ]);
  const open = opportunities.filter(o => !['CLOSED_WON','CLOSED_LOST'].includes(o.stage));
  const won = opportunities.filter(o => o.stage === 'CLOSED_WON');
  return { companies, opportunities: opportunities.length, assessments, openTasks: tasks, pipelineValue: open.reduce((n,o) => n+Number(o.value),0), confirmedRevenue: won.reduce((n,o) => n+Number(o.value),0), pipeline: grouped.map(g => ({ stage: g.stage, count: g._count, value: Number(g._sum.value || 0) })) };
});
app.get('/api/integrations', { preHandler: requirePermission('view') }, async req => prisma.integration.findMany({ where: { workspaceId: req.auth!.workspaceId }, select: { id:true, provider:true, status:true, createdAt:true, updatedAt:true } }));

const port = Number(process.env.PORT || 4100);
if (process.env.NODE_ENV !== 'test') app.listen({ port, host: '0.0.0.0' }).catch(error => { app.log.error(error); process.exit(1); });
