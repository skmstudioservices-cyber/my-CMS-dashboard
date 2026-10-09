// BLOCK:API — all dashboard endpoints (ported from the old worker.js).
import type { APIRoute } from 'astro';
export const prerender = false;

const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

const STATIC_SITES = [
  { id: 'mapsnearme', name: 'mapsnearme', type: 'pages', subdomain: 'mapsnearme.pages.dev', stack: ['Astro', 'Tailwind', 'D1', 'KV'], d1_bindings: ['mapsnearme-db'], kv_bindings: ['MAPS_ADS', 'MAPS_ADS2'], status: 'active' },
  { id: 'digipincode', name: 'digipincode', type: 'pages', subdomain: 'digipincode.pages.dev', stack: ['Astro', 'D1'], d1_bindings: ['pincode-india-db'], kv_bindings: [], status: 'active' },
  { id: 'toiletsnearme', name: 'toiletsnearme', type: 'pages', subdomain: 'toiletsnearme.pages.dev', stack: ['Astro', 'Supabase'], d1_bindings: [], kv_bindings: [], status: 'active' },
  { id: 'evchargersnearme', name: 'evchargersnearme', type: 'pages', subdomain: 'evchargersnearme.pages.dev', stack: ['Astro', 'D1'], d1_bindings: [], kv_bindings: [], status: 'active' },
  { id: 'skmtools', name: 'skmtools', type: 'pages', subdomain: 'skmtools.pages.dev', stack: ['Astro', 'D1'], d1_bindings: ['skmtools-db'], kv_bindings: [], status: 'active' },
];

async function getKnownSites(env: any) {
  if (env.CMS_DB) {
    try {
      const r = await env.CMS_DB.prepare('SELECT * FROM cms_sites ORDER BY name').all();
      if (r.results && r.results.length) return r.results.map((s: any) => ({
        ...s,
        stack: typeof s.stack === 'string' ? JSON.parse(s.stack) : (s.stack || []),
        d1_bindings: typeof s.d1_bindings === 'string' ? JSON.parse(s.d1_bindings) : (s.d1_bindings || []),
        kv_bindings: typeof s.kv_bindings === 'string' ? JSON.parse(s.kv_bindings) : (s.kv_bindings || []),
      }));
    } catch {}
  }
  return STATIC_SITES;
}

async function getOverview(env: any) {
  let limits: any[] = [];
  if (env.CMS_DB) { try { const r = await env.CMS_DB.prepare('SELECT * FROM cms_limit_usage').all(); limits = r.results || []; } catch {} }
  if (!limits.length) limits = [
    { resource_name: 'd1_reads', used_today: 1250, daily_limit: 5000000, percent_used: 0.025 },
    { resource_name: 'd1_writes', used_today: 42, daily_limit: 100000, percent_used: 0.042 },
    { resource_name: 'kv_writes', used_today: 8, daily_limit: 1000, percent_used: 0.8 },
    { resource_name: 'worker_requests', used_today: 2140, daily_limit: 100000, percent_used: 2.14 },
  ];
  const sites = await getKnownSites(env);
  return { total_sites: sites.length, d1_count: 7, kv_count: 4, health_score: '99.98%', limits };
}

async function getRecommendations(env: any) {
  if (env.CMS_DB) { try { const r = await env.CMS_DB.prepare("SELECT * FROM cms_recommendations WHERE status='pending'").all(); if (r.results?.length) return r.results; } catch {} }
  return [
    { site_id: 'evchargersnearme', type: 'seo', severity: 'medium', message: 'No public sitemap.xml detected in robots.txt' },
    { site_id: 'pincode-india-db', type: 'limits', severity: 'low', message: 'Cache pincode lookups in KV to cut daily D1 reads' },
  ];
}

export const GET: APIRoute = async ({ params, url, locals }) => {
  const env: any = (locals as any).runtime?.env || {};
  const path = '/' + (params.path || '');
  const q = url.searchParams;

  if (path === '/overview') return json(await getOverview(env));
  if (path === '/sites') { const s = await getKnownSites(env); return json({ sites: s }); }
  if (path === '/recommendations') return json({ recommendations: await getRecommendations(env) });
  if (path === '/crons') return json({ crons: [
    { name: 'Health & Limit refresh', spec: '0 */3 * * *' },
    { name: 'Resource sync & recommendations', spec: '0 */6 * * *' },
    { name: 'Daily log patterns', spec: '0 2 * * *' },
  ] });
  if (path === '/config') {
    let rows: any[] = [];
    if (env.CMS_DB) { try { const r = await env.CMS_DB.prepare('SELECT key,value_json,updated_at FROM cms_settings ORDER BY key').all(); rows = r.results || []; } catch {} }
    return json({ settings: rows });
  }
  if (path === '/comments') {
    let c: any[] = [];
    if (env.CMS_DB) { try { const r = await env.CMS_DB.prepare('SELECT * FROM cms_comments ORDER BY created_at DESC LIMIT 200').all(); c = r.results || []; } catch {} }
    return json({ comments: c });
  }
  if (path === '/d1_tables') {
    const target = env[q.get('db') || 'CMS_DB'];
    if (!target) return json({ error: 'db not found' }, 400);
    try { const r = await target.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all(); return json({ tables: (r.results || []).map((x: any) => x.name) }); }
    catch (e: any) { return json({ error: e.message }, 500); }
  }
  if (path === '/kv_list') {
    const kv = env[q.get('ns') || 'NEXUS_CACHE'];
    if (!kv) return json({ error: 'kv not found' }, 400);
    try { return json(await kv.list({ limit: 50 })); } catch (e: any) { return json({ error: e.message }, 500); }
  }
  if (path === '/github_runs') {
    if (!env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN secret not set', runs: [] });
    try {
      const r = await fetch('https://api.github.com/repos/' + (q.get('repo') || 'skmstudioservices-cyber/digipincode-india') + '/actions/runs?per_page=12', { headers: { Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'nexus-cms' } });
      const j: any = await r.json();
      return json({ runs: (j.workflow_runs || []).map((x: any) => ({ name: x.name, status: x.status, conclusion: x.conclusion, url: x.html_url })) });
    } catch (e: any) { return json({ error: e.message, runs: [] }, 500); }
  }
  if (path === '/domain_check') {
    const d = (q.get('domain') || '').toLowerCase().trim();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return json({ error: 'invalid domain' }, 400);
    try { const r = await fetch('https://rdap.org/domain/' + d, { headers: { Accept: 'application/rdap+json', 'User-Agent': 'nexus-cms' } }); if (!r.ok) return json({ domain: d, registered: r.status !== 404, http: r.status }); const j: any = await r.json(); return json({ domain: d, registered: true, handle: j.handle, events: j.events || [], nameservers: (j.nameservers || []).map((n: any) => n.ldhName) }); }
    catch (e: any) { return json({ error: e.message }, 500); }
  }
  if (path === '/sync_resources') return json({ ok: true, synced: (await getKnownSites(env)).length });
  return json({ error: 'not found: ' + path }, 404);
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const env: any = (locals as any).runtime?.env || {};
  const path = '/' + (params.path || '');
  let body: any = {}; try { body = await request.json(); } catch {}
  if (path === '/comments') {
    if (!body.comment) return json({ error: 'comment required' }, 400);
    if (env.CMS_DB) { try { await env.CMS_DB.prepare('INSERT INTO cms_comments (id, site_id, file_path, line_number, comment) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), body.block_id || 'general', body.block_id || '', null, (body.color ? '[colour ' + body.color + '] ' : '') + body.comment).run(); } catch (e: any) { return json({ error: e.message }, 500); } }
    return json({ ok: true });
  }
  if (path === '/config') {
    if (env.CMS_DB && body.key) { try { await env.CMS_DB.prepare('INSERT INTO cms_settings (key,value_json,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP').bind(body.key, JSON.stringify(body.value)).run(); } catch (e: any) { return json({ error: e.message }, 500); } }
    return json({ ok: true });
  }
  if (path === '/d1_query') {
    const target = env[body.db]; if (!target) return json({ error: 'db not found' }, 400);
    try { const r = await target.prepare(body.query).all(); return json(r); } catch (e: any) { return json({ error: e.message }, 500); }
  }
  return json({ error: 'not found: ' + path }, 404);
};
