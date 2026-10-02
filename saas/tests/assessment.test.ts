import { afterAll, describe, expect, it } from 'vitest';
import { app, calculateAssessment, prisma } from '../src/server';

describe('India Market Entry Score calculation', () => {
  const full = Object.fromEntries(Array.from({length:15},(_,i)=>[String(i+1),'YES']));
  it('scores all positive dimensions at 100 and identifies the strengths', () => {
    const result = calculateAssessment(full);
    expect(result.score).toBe(100);
    expect(result.answered).toBe(15);
    expect(result.strengths).toHaveLength(15);
    expect(result.gaps).toHaveLength(0);
  });
  it('scores mixed answers server side and reports gaps and risks', () => {
    const result = calculateAssessment({...full,'1':'NO','2':'NOT SURE'});
    expect(result.score).toBe(90);
    expect(result.gaps).toContain('Market Relevance');
    expect(result.risks).toContain('Product-Market Fit');
    expect(result.recommendedActions.length).toBeGreaterThan(0);
  });
  it('calculates a provisional average only over answered dimensions', () => {
    const result = calculateAssessment({'1':'YES'});
    expect(result.score).toBe(100);
    expect(result.answered).toBe(1);
  });
});

afterAll(async()=>{await app.close();await prisma.$disconnect();});

const databaseSuite = describe.skipIf(!process.env.DATABASE_URL);
databaseSuite('authentication and tenant isolation (PostgreSQL)',()=>{
  const runId = crypto.randomUUID();
  const orgIds:string[]=[];
  async function register(email:string, organizationName:string) {
    const csrfResponse=await app.inject({method:'GET',url:'/api/auth/csrf'});
    const csrfCookie=String(csrfResponse.headers['set-cookie']).split(';')[0];
    const csrfToken=csrfResponse.json().csrfToken;
    const response=await app.inject({method:'POST',url:'/api/auth/register',headers:{origin:process.env.WEB_ORIGIN||'http://localhost:5173',cookie:csrfCookie,'x-csrf-token':csrfToken},payload:{name:'Test User',email,password:'Test-password-2468',organizationName}});
    expect(response.statusCode).toBe(201);
    const sessionCookie=String(response.headers['set-cookie']).split(';')[0];
    const cookie=`${csrfCookie}; ${sessionCookie}`;
    const membership=await prisma.workspaceMember.findFirst({where:{user:{email}},include:{workspace:true}});
    if(membership)orgIds.push(membership.workspace.organizationId);
    return {cookie,csrfToken};
  }
  it('creates isolated organizations and blocks cross-tenant record reads',async()=>{
    const first=await register(`one-${runId}@example.test`,`Workspace One ${runId}`);
    const company=await app.inject({method:'POST',url:'/api/companies',headers:{origin:process.env.WEB_ORIGIN||'http://localhost:5173',cookie:first.cookie,'x-csrf-token':first.csrfToken},payload:{name:'Tenant One Account'}});
    expect(company.statusCode).toBe(201);
    const loginCsrf=await app.inject({method:'GET',url:'/api/auth/csrf'});
    const loginCookie=String(loginCsrf.headers['set-cookie']).split(';')[0];
    const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{origin:process.env.WEB_ORIGIN||'http://localhost:5173',cookie:loginCookie,'x-csrf-token':loginCsrf.json().csrfToken},payload:{email:`one-${runId}@example.test`,password:'Test-password-2468'}});
    expect(login.statusCode).toBe(200);
    const secondEmail=`two-${runId}@example.test`;
    const second=await register(secondEmail,`Workspace Two ${runId}`);
    const storedUser=await prisma.user.findUnique({where:{email:secondEmail}});
    expect(storedUser?.passwordHash).toMatch(/^scrypt\$/);
    expect(storedUser?.passwordHash).not.toBe('Test-password-2468');
    await prisma.workspaceMember.updateMany({where:{userId:storedUser!.id},data:{role:'CLIENT_VIEWER'}});
    const list=await app.inject({method:'GET',url:'/api/companies',headers:{cookie:second.cookie}});
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([]);
    const forbidden=await app.inject({method:'POST',url:'/api/companies',headers:{origin:process.env.WEB_ORIGIN||'http://localhost:5173',cookie:second.cookie,'x-csrf-token':second.csrfToken},payload:{name:'Viewer Cannot Create'}});
    expect(forbidden.statusCode).toBe(403);
    const me=await app.inject({method:'GET',url:'/api/auth/me',headers:{cookie:second.cookie}});
    expect(me.statusCode).toBe(200);
  });
  afterAll(async()=>{
    await prisma.organization.deleteMany({where:{id:{in:orgIds}}});
    await prisma.user.deleteMany({where:{email:{contains:runId}}});
  });
});
