import { beforeAll, afterAll, it, expect } from 'vitest';
import { buildServer } from '../../src/server';
let app:any;
beforeAll(async()=>{ app=buildServer(); await app.ready(); });
afterAll(async()=>{ await app.close(); });
it('health', async ()=>{ const res=await app.inject({method:'GET', url:'/health'}); expect(res.statusCode).toBe(200); });