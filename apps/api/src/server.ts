import fastify from 'fastify';
export function buildServer(){ const app=fastify(); app.get('/health',async()=>({ok:true})); return app; }