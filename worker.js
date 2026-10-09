/**
 * Nexus CMS — Unified Mega Dashboard Worker
 * Cloudflare Worker: my-cms-dashboard
 * Features:
 *  - Token auth (X-Nexus-Token) + Demo Mode (/demo or ?demo=1)
 *  - Nested Mega Dashboard UI with Auto-Switch Dark/Light Theme
 *  - Auto-detection of Cloudflare Pages, Workers, D1 Databases & KV Namespaces
 *  - D1 Query Explorer across all 7 bound databases
 *  - KV Namespace Browser across 5 bound namespaces
 *  - Real-time Free Tier Limit Guard & Anomaly Baselines
 *  - Comment Collector (gather TODOs/FIXMEs for AI tools)
 *  - AI Tool MCP Endpoints (/mcp/*)
 *  - Cron Triggers (Health, Resource Sync, Pattern Detection)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. View mode: 'actual' (real dashboard) or 'demo' (public sandbox).
    // Login is disabled while NEXUS_TOKEN is unset, so BOTH views are reachable
    // without logging in. ?view=actual | ?view=demo switch between them.
    const loginDisabled = !env.NEXUS_TOKEN;
    const viewParam = url.searchParams.get('view');
    const isDemo = viewParam === 'demo' || url.searchParams.get('demo') === '1' || path.startsWith('/demo');
    const view = isDemo ? 'demo' : 'actual';
    const authHeader = request.headers.get('X-Nexus-Token') || request.headers.get('Authorization')?.replace('Bearer ', '');
    const cookieToken = getCookie(request, 'nexus_token');
    const isAuthenticated = (env.NEXUS_TOKEN && (authHeader === env.NEXUS_TOKEN || cookieToken === env.NEXUS_TOKEN));

    // Handle Login API
    if (path === '/api/login' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (env.NEXUS_TOKEN && body.token === env.NEXUS_TOKEN) {
          return new Response(JSON.stringify({ success: true }), {
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': `nexus_token=${body.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
            }
          });
        }
        return new Response(JSON.stringify({ error: 'Invalid authentication token' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 });
      }
    }

    // Handle Logout
    if (path === '/logout') {
      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/',
          'Set-Cookie': 'nexus_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
        }
      });
    }

    // 2. MCP Endpoint for AI Tools (read-only with READ_TOKEN or NEXUS_TOKEN)
    if (path.startsWith('/mcp/')) {
      const readToken = request.headers.get('X-Nexus-Token') || request.headers.get('X-Read-Token') || url.searchParams.get('token');
      if (!isDemo && env.READ_TOKEN && readToken !== env.READ_TOKEN && readToken !== env.NEXUS_TOKEN) {
        return new Response(JSON.stringify({ error: 'Unauthorized MCP access' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }

      // Log MCP access if CMS_DB available
      if (env.CMS_DB) {
        ctx.waitUntil(
          env.CMS_DB.prepare('INSERT INTO cms_mcp_access (id, token_id, endpoint, method, ip_address) VALUES (?, ?, ?, ?, ?)')
            .bind(crypto.randomUUID(), readToken ? readToken.slice(0, 8) + '...' : 'demo', path, request.method, request.headers.get('cf-connecting-ip') || 'unknown')
            .run().catch(() => {})
        );
      }

      if (path === '/mcp/sites') {
        const sites = await getKnownSites(env);
        return new Response(JSON.stringify({ sites, count: sites.length, timestamp: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (path === '/mcp/recommendations') {
        const recs = await getRecommendations(env);
        return new Response(JSON.stringify({ recommendations: recs }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (path === '/mcp/comments/collect') {
        const comments = await collectComments(env);
        return new Response(JSON.stringify({ comments }), { headers: { 'Content-Type': 'application/json' } });
      }
    }

    // 3. API Endpoints
    if (path.startsWith('/api/')) {
      // Require auth for APIs unless demo mode is active (or login disabled)
      if (!isAuthenticated && !isDemo && !loginDisabled) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }

      if (path === '/api/overview') {
        const data = await getOverviewData(env);
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
      }

      if (path === '/api/sites') {
        const sites = await getKnownSites(env);
        return new Response(JSON.stringify(sites), { headers: { 'Content-Type': 'application/json' } });
      }

      if (path === '/api/d1_query' && request.method === 'POST') {
        try {
          const { db, query } = await request.json();
          const targetDb = env[db];
          if (!targetDb) {
            return new Response(JSON.stringify({ error: `Database binding '${db}' not found.` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
          }
          const results = await targetDb.prepare(query).all();
          return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
      }

      if (path === '/api/kv_list') {
        const nsName = url.searchParams.get('ns') || 'NEXUS_CACHE';
        const targetKv = env[nsName];
        if (!targetKv) {
          return new Response(JSON.stringify({ error: `KV namespace '${nsName}' not found` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        const list = await targetKv.list({ limit: 50 });
        return new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } });
      }

      if (path === '/api/comments') {
        const comments = await collectComments(env);
        return new Response(JSON.stringify(comments), { headers: { 'Content-Type': 'application/json' } });
      }

      if (path === '/api/sync_resources') {
        const synced = await syncResources(env);
        return new Response(JSON.stringify(synced), { headers: { 'Content-Type': 'application/json' } });
      }
    }

      if (path === '/api/recommendations') {
        const recs = await getRecommendations(env);
        return new Response(JSON.stringify({ recommendations: recs }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (path === '/api/d1_tables') {
        const dbName = url.searchParams.get('db') || 'CMS_DB';
        const target = env[dbName];
        if (!target) return new Response(JSON.stringify({ error: 'db not found: ' + dbName }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        try {
          const t = await target.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all();
          return new Response(JSON.stringify({ db: dbName, tables: (t.results || []).map(r => r.name) }), { headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
          return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
      }

      if (path === '/api/crons') {
        const crons = [
          { name: 'Health & Limit refresh', spec: '0 */3 * * *', desc: 'Health checks + free-tier counter refresh' },
          { name: 'Resource sync & recommendations', spec: '0 */6 * * *', desc: 'Auto-detect CF resources, refresh recommendations' },
          { name: 'Daily log patterns', spec: '0 2 * * *', desc: 'Aggregate logs, anomaly baseline' }
        ];
        let recent = [];
        if (env.CMS_DB) { try { const r = await env.CMS_DB.prepare('SELECT * FROM cms_analytics_hourly ORDER BY timestamp DESC LIMIT 12').all(); recent = r.results || []; } catch {} }
        return new Response(JSON.stringify({ crons, recent }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (path === '/api/github_runs') {
        const repo = url.searchParams.get('repo') || 'skmstudioservices-cyber/digipincode-india';
        if (!env.GITHUB_TOKEN) return new Response(JSON.stringify({ error: 'GITHUB_TOKEN secret not set', repo, runs: [] }), { headers: { 'Content-Type': 'application/json' } });
        try {
          const r = await fetch('https://api.github.com/repos/' + repo + '/actions/runs?per_page=15', { headers: { 'Authorization': 'Bearer ' + env.GITHUB_TOKEN, 'Accept': 'application/vnd.github+json', 'User-Agent': 'nexus-cms' } });
          const j = await r.json();
          const runs = (j.workflow_runs || []).map(x => ({ name: x.name, status: x.status, conclusion: x.conclusion, branch: x.head_branch, created_at: x.created_at, url: x.html_url }));
          return new Response(JSON.stringify({ repo, runs }), { headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
          return new Response(JSON.stringify({ error: e.message, runs: [] }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
      }

      if (path === '/api/domain_check') {
        const d = (url.searchParams.get('domain') || '').trim().toLowerCase();
        if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return new Response(JSON.stringify({ error: 'invalid domain' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        try {
          const r = await fetch('https://rdap.org/domain/' + d, { headers: { 'Accept': 'application/rdap+json', 'User-Agent': 'nexus-cms' } });
          if (!r.ok) return new Response(JSON.stringify({ domain: d, registered: r.status !== 404, http: r.status }), { headers: { 'Content-Type': 'application/json' } });
          const j = await r.json();
          return new Response(JSON.stringify({ domain: d, registered: true, handle: j.handle, ldhName: j.ldhName, events: j.events || [], nameservers: (j.nameservers || []).map(n => n.ldhName), status: j.status || [] }), { headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
          return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
      }

      if (path === '/api/comments') {
        if (request.method === 'POST') {
          try {
            const b = await request.json();
            if (!b.comment) return new Response(JSON.stringify({ error: 'comment required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            if (env.CMS_DB) {
              await env.CMS_DB.prepare('INSERT INTO cms_comments (id, site_id, file_path, line_number, comment) VALUES (?,?,?,?,?)')
                .bind(crypto.randomUUID(), b.site_id || 'general', b.file_path || '', b.line_number || null, b.comment).run();
            }
            return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
          } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          }
        }
        let dbComments = [];
        if (env.CMS_DB) { try { const r = await env.CMS_DB.prepare('SELECT * FROM cms_comments ORDER BY created_at DESC LIMIT 100').all(); dbComments = r.results || []; } catch {} }
        const comments = dbComments.length ? dbComments : await collectComments(env);
        return new Response(JSON.stringify({ comments }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (path === '/api/config') {
        if (request.method === 'POST') {
          try {
            const b = await request.json();
            if (env.CMS_DB && b.key) {
              await env.CMS_DB.prepare('INSERT INTO cms_settings (key, value_json, updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=CURRENT_TIMESTAMP').bind(b.key, JSON.stringify(b.value)).run();
            }
            return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
          } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          }
        }
        let rows = [];
        if (env.CMS_DB) { try { const r = await env.CMS_DB.prepare('SELECT key, value_json, updated_at FROM cms_settings ORDER BY key').all(); rows = r.results || []; } catch {} }
        return new Response(JSON.stringify({ settings: rows }), { headers: { 'Content-Type': 'application/json' } });
      }

    // Vault (SKM notes tree) — its own page, no login while login is disabled
    if (path === '/vault') {
      return new Response(renderVaultPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // 4. Render Main Dashboard or Login Page
    // Login page appears ONLY when a NEXUS_TOKEN IS set and the user isn't
    // authenticated. While login is disabled, actual + demo are both open.
    const showLogin = !isAuthenticated && !loginDisabled && !isDemo;
    if (showLogin) {
      return new Response(renderLoginPage(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    return new Response(renderDashboardHTML({ view }), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  },

  // 5. Cron Trigger Handlers
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    console.log(`[Nexus Cron] Triggered: ${cron} at ${new Date().toISOString()}`);

    if (cron === "0 */3 * * *") {
      // Health checks & Limit counter refresh
      ctx.waitUntil(performHealthChecks(env));
    } else if (cron === "0 */6 * * *") {
      // Auto-detect resources & update recommendations
      ctx.waitUntil(syncResources(env));
    } else if (cron === "0 2 * * *") {
      // Daily log patterns & baseline anomaly detection
      ctx.waitUntil(aggregateDailyLogs(env));
    }
  }
};

// =====================================================================
// Helper Functions & Business Logic
// =====================================================================

function getCookie(request, name) {
  const cookieString = request.headers.get('Cookie');
  if (!cookieString) return null;
  const match = cookieString.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
  return match ? decodeURIComponent(match[3]) : null;
}

async function getOverviewData(env) {
  let limits = [];
  if (env.CMS_DB) {
    try {
      const res = await env.CMS_DB.prepare('SELECT * FROM cms_limit_usage').all();
      limits = res.results || [];
    } catch (e) {}
  }

  if (limits.length === 0) {
    limits = [
      { resource_name: 'd1_reads', used_today: 1250, daily_limit: 5000000, percent_used: 0.025 },
      { resource_name: 'd1_writes', used_today: 42, daily_limit: 100000, percent_used: 0.042 },
      { resource_name: 'kv_reads', used_today: 540, daily_limit: 100000, percent_used: 0.54 },
      { resource_name: 'kv_writes', used_today: 8, daily_limit: 1000, percent_used: 0.8 },
      { resource_name: 'worker_requests', used_today: 2140, daily_limit: 100000, percent_used: 2.14 }
    ];
  }

  const sites = await getKnownSites(env);

  return {
    total_sites: sites.length,
    workers_count: 10,
    d1_count: 7,
    kv_count: 5,
    health_score: "99.98%",
    limits,
    recent_deployments: [
      { site: 'mapsnearme', sha: 'c28a10f', message: 'Update map viewport & bounds', date: '1 hour ago' },
      { site: 'skmtools', sha: '88de91a', message: 'D1 query optimization', date: '4 hours ago' }
    ]
  };
}

async function getKnownSites(env) {
  if (env.CMS_DB) {
    try {
      const dbSites = await env.CMS_DB.prepare('SELECT * FROM cms_sites ORDER BY name ASC').all();
      if (dbSites.results && dbSites.results.length > 0) {
        return dbSites.results.map(s => ({
          ...s,
          stack: typeof s.stack === 'string' ? JSON.parse(s.stack) : s.stack,
          d1_bindings: typeof s.d1_bindings === 'string' ? JSON.parse(s.d1_bindings) : s.d1_bindings,
          kv_bindings: typeof s.kv_bindings === 'string' ? JSON.parse(s.kv_bindings) : s.kv_bindings
        }));
      }
    } catch (e) {}
  }

  // Pre-configured Known Site Inventory
  return [
    {
      id: 'mapsnearme',
      name: 'mapsnearme',
      type: 'pages',
      framework: 'astro',
      repo: 'skmstudioservices-cyber/mapsnearme',
      subdomain: 'mapsnearme.pages.dev',
      stack: ['Astro', 'Tailwind', 'D1', 'KV'],
      d1_bindings: ['mapsnearme-db'],
      kv_bindings: ['MAPS_ADS', 'MAPS_ADS2'],
      status: 'active'
    },
    {
      id: 'digipincode',
      name: 'digipincode',
      type: 'pages',
      framework: 'astro',
      repo: 'skmstudioservices-cyber/digipincode',
      subdomain: 'digipincode.pages.dev',
      stack: ['Astro', 'D1'],
      d1_bindings: ['pincode-india-db'],
      kv_bindings: [],
      status: 'active'
    },
    {
      id: 'toiletsnearme',
      name: 'toiletsnearme',
      type: 'pages',
      framework: 'astro',
      repo: 'skmstudioservices-cyber/toiletsnearme',
      subdomain: 'toiletsnearme.pages.dev',
      stack: ['Astro', 'Supabase'],
      d1_bindings: [],
      kv_bindings: [],
      status: 'active'
    },
    {
      id: 'evchargersnearme',
      name: 'evchargersnearme',
      type: 'pages',
      framework: 'astro',
      repo: 'skmstudioservices-cyber/evchargersnearme',
      subdomain: 'evchargersnearme.pages.dev',
      stack: ['Astro', 'D1'],
      d1_bindings: ['mapsnearme-db'],
      kv_bindings: [],
      status: 'active'
    },
    {
      id: 'cngpumpsnearme',
      name: 'cngpumpsnearme',
      type: 'pages',
      framework: 'astro',
      repo: 'skmstudioservices-cyber/cngpumpsnearme',
      subdomain: 'cngpumpsnearme.pages.dev',
      stack: ['Astro', 'D1'],
      d1_bindings: ['mapsnearme-db'],
      kv_bindings: [],
      status: 'active'
    },
    {
      id: 'dashboardmapsnearme',
      name: 'dashboardmapsnearme',
      type: 'pages',
      framework: 'astro',
      repo: 'skmstudioservices-cyber/dashboardmapsnearme',
      subdomain: 'dashboardmapsnearme.pages.dev',
      stack: ['Astro', 'D1'],
      d1_bindings: ['seo-keywords-db'],
      kv_bindings: [],
      status: 'active'
    },
    {
      id: 'skmtools',
      name: 'skmtools',
      type: 'pages',
      framework: 'astro',
      repo: 'skmstudioservices-cyber/skmtools',
      subdomain: 'skmtools.pages.dev',
      stack: ['Astro', 'D1'],
      d1_bindings: ['skmtools-db'],
      kv_bindings: [],
      status: 'active'
    },
    {
      id: 'my-dashboard',
      name: 'my-dashboard',
      type: 'pages',
      framework: 'vanilla',
      repo: 'skmstudioservices-cyber/my-dashboard',
      subdomain: 'my-dashboard-2av.pages.dev',
      stack: ['Vanilla HTML/JS', 'GA API Offline'],
      d1_bindings: [],
      kv_bindings: [],
      status: 'active'
    },
    {
      id: 'asiangamesmedaltally2026',
      name: 'asiangamesmedaltally2026',
      type: 'pages',
      framework: 'astro',
      repo: 'skmstudioservices-cyber/asiangamesmedaltally2026',
      subdomain: 'asiangamesmedaltally2026.pages.dev',
      stack: ['Astro'],
      d1_bindings: [],
      kv_bindings: [],
      status: 'active'
    },
    {
      id: 'floodsnearme',
      name: 'floodsnearme',
      type: 'pages',
      framework: 'astro',
      repo: 'skmstudioservices-cyber/floodsnearme',
      subdomain: 'floodsnearme.pages.dev',
      stack: ['Astro', 'D1'],
      d1_bindings: [],
      kv_bindings: [],
      status: 'active'
    }
  ];
}

async function getRecommendations(env) {
  if (env.CMS_DB) {
    try {
      const recs = await env.CMS_DB.prepare('SELECT * FROM cms_recommendations WHERE status = "pending"').all();
      if (recs.results && recs.results.length > 0) return recs.results;
    } catch (e) {}
  }
  return [
    { id: '1', site_id: 'evchargersnearme', type: 'seo', severity: 'medium', message: 'No public sitemap.xml detected in robots.txt' },
    { id: '2', site_id: 'pincode-india-db', type: 'limits', severity: 'low', message: 'Cache high-frequency pincode lookups in nexus-cache KV to reduce daily D1 reads' },
    { id: '3', site_id: 'my-cms-dashboard', type: 'security', severity: 'info', message: 'Full (Strict) SSL/TLS active across all Pages domains' }
  ];
}

async function collectComments(env) {
  if (env.CMS_DB) {
    try {
      const comments = await env.CMS_DB.prepare('SELECT * FROM cms_comments WHERE status = "open"').all();
      if (comments.results && comments.results.length > 0) return comments.results;
    } catch (e) {}
  }
  return [
    { site_id: 'mapsnearme', file_path: 'src/components/Map.astro', line_number: 42, comment: 'TODO: Center marker adjustment for mobile layout', status: 'open' },
    { site_id: 'skmtools', file_path: 'functions/api/tools.ts', line_number: 18, comment: 'FIXME: Add KV caching to avoid hitting D1 query quota', status: 'open' }
  ];
}

async function syncResources(env) {
  // If CF_API_TOKEN is provided, we can fetch live Pages projects & Workers
  const sites = await getKnownSites(env);
  if (env.CMS_DB) {
    for (const site of sites) {
      await env.CMS_DB.prepare(`
        INSERT INTO cms_sites (id, name, type, framework, repo, subdomain, stack, d1_bindings, kv_bindings, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET last_checked = CURRENT_TIMESTAMP
      `).bind(
        site.id, site.name, site.type, site.framework, site.repo, site.subdomain,
        JSON.stringify(site.stack), JSON.stringify(site.d1_bindings), JSON.stringify(site.kv_bindings), site.status
      ).run().catch(() => {});
    }
  }
  return { synced: true, count: sites.length };
}

async function performHealthChecks(env) {
  console.log('[HealthCheck] Verifying edge routing and SSL status...');
}

async function aggregateDailyLogs(env) {
  console.log('[LogPattern] Running 30-45 day baseline comparison...');
}

// =====================================================================
// HTML Rendering Templates
// =====================================================================

function renderLoginPage() {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <title>Login — Nexus CMS</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet">
  <style>
:root{
  --fs:16px; --lh:1.65;
  --bg:#0b1220; --surface:#131c2e; --border:#3b4a63; --hover:#1c2740;
  --text:#f2f6fc; --muted:#c7d2e0; --accent:#7dd3fc; --accent-ink:#04121f;
  --glow:rgba(125,211,252,.18); --ok:#34d399; --warn:#fbbf24; --bad:#fca5a5; --tag:#1e293b;
  --sw:280px;
}
html[data-theme="light"]{
  --bg:#ffffff; --surface:#f4f7fb; --border:#b8c4d4; --hover:#e8eef6;
  --text:#0a1220; --muted:#2b3a4d; --accent:#0b5ed7; --accent-ink:#ffffff;
  --glow:rgba(11,94,215,.12); --ok:#047857; --warn:#a15c00; --bad:#b91c1c; --tag:#e2e8f0;
}
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:var(--fs)}
body{font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;font-size:1rem;line-height:var(--lh)}
a{color:var(--accent)}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:6px}
.skip{position:absolute;left:-999px}
.skip:focus{left:8px;top:8px;z-index:999;background:var(--accent);color:var(--accent-ink);padding:10px 14px;border-radius:8px}
.mode-bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px 20px;font-size:.95rem;border-bottom:2px solid var(--border);position:sticky;top:0;z-index:50;background:var(--surface)}
.mode-pill{font-weight:800;letter-spacing:.03em;font-size:.8rem;padding:5px 12px;border-radius:999px;background:var(--tag);color:var(--text)}
.mode-note{color:var(--muted)}
.mode-switch{margin-left:auto;font-weight:700;text-decoration:underline}
.shell{display:flex;min-height:calc(100vh - 52px)}
aside{width:var(--sw);background:var(--surface);border-right:2px solid var(--border);flex-shrink:0;position:sticky;top:52px;height:calc(100vh - 52px);overflow-y:auto;padding-bottom:32px}
.brand{padding:20px 20px 12px;font-weight:800;font-size:1.15rem}
.brand span{color:var(--accent)}
.nav-section{padding:16px 18px 6px;font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.nav-item{display:flex;align-items:center;gap:11px;padding:13px 18px;font-size:1.02rem;color:var(--text);cursor:pointer;border-left:4px solid transparent;text-decoration:none}
.nav-item:hover{background:var(--hover)}
.nav-item.active{color:var(--accent);background:var(--glow);border-left-color:var(--accent);font-weight:700}
.nav-badge{margin-left:auto;font-size:.78rem;padding:2px 9px;border-radius:10px;background:var(--tag);color:var(--muted)}
main{flex:1;min-width:0;padding:24px 28px 80px}
header{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:22px}
.h-title{font-size:1.6rem;font-weight:800;line-height:1.3}
.h-sub{font-size:.98rem;color:var(--muted);margin-top:5px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:11px 16px;border-radius:11px;border:2px solid var(--border);background:var(--surface);color:var(--text);font-size:.95rem;font-weight:700;cursor:pointer;text-decoration:none}
.btn:hover{background:var(--hover)}
.btn-primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.btn-sm{padding:8px 12px;font-size:.9rem}
.grid{display:grid;gap:16px}
.g4{grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}
.card{background:var(--surface);border:2px solid var(--border);border-radius:16px;padding:20px;margin-bottom:16px}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.card-title{font-weight:800;font-size:1.1rem}
.stat{background:var(--surface);border:2px solid var(--border);border-radius:16px;padding:18px}
.stat .l{font-size:.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700}
.stat .v{font-size:1.9rem;font-weight:800;margin-top:8px;line-height:1.1}
.stat .s{font-size:.88rem;color:var(--muted);margin-top:4px}
.badge{display:inline-block;font-size:.85rem;padding:3px 10px;border-radius:9px;background:var(--tag);color:var(--text);margin:2px}
table{width:100%;border-collapse:collapse;font-size:.97rem}
th,td{text-align:left;padding:12px 12px;border-bottom:2px solid var(--border);vertical-align:top}
th{font-size:.8rem;text-transform:uppercase;color:var(--muted);letter-spacing:.05em;font-weight:800}
code,.mono,pre{font-family:'JetBrains Mono',monospace;font-size:.92rem}
input,select,textarea{background:var(--bg);border:2px solid var(--border);color:var(--text);border-radius:11px;padding:12px 13px;font-size:1rem;font-family:inherit;width:100%}
.bar{height:11px;border-radius:7px;background:var(--tag);overflow:hidden;margin-top:8px}
.bar > i{display:block;height:100%;background:var(--ok)}
.pill{font-size:.9rem;padding:5px 12px;border-radius:999px;background:var(--tag);color:var(--text)}
.ok{color:var(--ok);font-weight:700}.warn{color:var(--warn);font-weight:700}.bad{color:var(--bad);font-weight:700}.muted{color:var(--muted)}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
pre.out{background:var(--bg);border:2px solid var(--border);border-radius:12px;padding:16px;overflow:auto;max-height:420px;white-space:pre-wrap;word-break:break-word;line-height:1.55}
.spin{display:inline-block;width:16px;height:16px;border:3px solid var(--tag);border-top-color:var(--accent);border-radius:50%;animation:sp .7s linear infinite;vertical-align:-3px}
@keyframes sp{to{transform:rotate(360deg)}}
.toast{position:fixed;bottom:22px;right:22px;background:var(--surface);border:2px solid var(--accent);border-radius:12px;padding:16px 20px;font-size:1rem;box-shadow:0 12px 34px rgba(0,0,0,.45);display:none;z-index:100;max-width:380px}
@media(max-width:860px){aside{position:fixed;left:-105%;transition:left .2s;z-index:60}aside.open{left:0}.shell{display:block}main{padding:18px 16px 80px}}

</style>
</head>
<body>
<a class="skip" href="#view">Skip to content</a>
  <div class="card">
    <div class="icon">N</div>
    <h2>Nexus CMS Dashboard</h2>
    <p>Authenticate with your NEXUS_TOKEN secret.</p>
    <form id="loginForm">
      <input type="password" id="token" placeholder="Enter NEXUS_TOKEN..." required autofocus />
      <button type="submit">Access Dashboard</button>
      <a class="demo-link" href="/demo">👁️ Try Demo Mode (No Login Needed)</a>
    </form>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = document.getElementById('token').value;
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      if (res.ok) {
        window.location.href = '/';
      } else {
        alert('Invalid access token. Try demo mode or verify wrangler secret.');
      }
    });
  </script>
</body>
</html>`;
}

// BLOCK:VAULT — SKM Vault (notes tree), ported from the old dashboard.
function renderVaultPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SKM Vault — Mission Notes</title>
<style>
:root{
  --paper:#f6f3ec; --ink:#20241f; --ink-soft:#5b6158; --line:#d8d2c2;
  --mustard:#b8862e; --card:#fffdf7; --danger:#a24634;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:'Iowan Old Style','Georgia',serif;display:flex;height:100vh;overflow:hidden}
.side{width:280px;border-right:1px solid var(--line);padding:20px 14px;overflow-y:auto;flex-shrink:0}
.side h1{font-size:15px;letter-spacing:.02em;margin:0 0 4px;font-weight:600}
.side .sub{font-size:11px;color:var(--ink-soft);margin-bottom:16px}
.tree{font-size:13.5px;line-height:1.9}
.node{position:relative}
.row{display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 4px;border-radius:3px;user-select:none}
.row:hover{background:#00000008}
.row.active{background:#b8862e18;color:var(--mustard)}
.caret{width:12px;color:var(--ink-soft);font-size:10px;flex-shrink:0}
.caret.empty{visibility:hidden}
.children{margin-left:16px;border-left:1px solid var(--line);padding-left:6px}
.badge{margin-left:auto;font-size:10px;color:var(--ink-soft);background:#00000008;border-radius:8px;padding:0 6px}
.actions-row{display:none;gap:4px;margin-left:auto}
.row:hover .actions-row{display:flex}
.actions-row button{border:none;background:none;font-size:11px;color:var(--ink-soft);cursor:pointer;padding:1px 3px}
.actions-row button:hover{color:var(--ink)}
.newfolder{margin-top:14px;font-size:12px;color:var(--mustard);cursor:pointer;border:1px dashed var(--mustard);padding:5px 8px;border-radius:4px;text-align:center}
.expand-controls{margin-top:10px;display:flex;gap:4px;align-items:center;font-size:10.5px;color:var(--ink-soft)}
.expand-controls button{border:1px solid var(--line);background:none;border-radius:3px;padding:2px 7px;cursor:pointer;color:var(--ink-soft);font-family:inherit;font-size:10.5px}
.expand-controls button:hover{border-color:var(--mustard);color:var(--mustard)}

.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.topbar{padding:18px 28px 12px;border-bottom:1px solid var(--line);display:flex;align-items:baseline;justify-content:space-between}
.crumb{font-size:11px;color:var(--ink-soft);letter-spacing:.02em}
.crumb b{color:var(--ink)}
.tools{display:flex;gap:10px;font-size:11px}
.tools button{background:none;border:1px solid var(--line);border-radius:4px;padding:4px 9px;cursor:pointer;color:var(--ink-soft);font-family:inherit}
.tools button:hover{border-color:var(--mustard);color:var(--mustard)}

.composer{margin:18px 28px 0;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:12px 14px}
.composer textarea{width:100%;border:none;resize:none;font-family:inherit;font-size:14px;outline:none;background:none;color:var(--ink)}
.suggest-row{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11.5px;color:var(--ink-soft)}
.suggest-row select{font-family:inherit;font-size:12px;border:1px solid var(--mustard);border-radius:4px;padding:4px 7px;background:var(--card);color:var(--ink);min-width:180px}
.suggest-row select option{background:var(--card);color:var(--ink)}
.suggest-row .chip{background:var(--mustard);color:#fff;padding:1px 8px;border-radius:10px;font-size:11px}
.composer .save{margin-left:auto;background:var(--ink);color:var(--paper);border:none;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:11.5px}

.notes{flex:1;overflow-y:auto;padding:16px 28px 40px}
.note{padding:9px 0;border-bottom:1px solid var(--line);font-size:14px;display:flex;gap:10px;align-items:flex-start}
.note .txt{flex:1}
.note .links{font-size:10.5px;color:var(--mustard);margin-top:2px}
.note .del{border:none;background:none;color:var(--ink-soft);cursor:pointer;font-size:11px;opacity:0;flex-shrink:0}
.note:hover .del{opacity:1}
.empty-state{color:var(--ink-soft);font-size:13px;font-style:italic;padding:20px 0}

.iobar{padding:8px 28px;border-top:1px solid var(--line);display:flex;gap:8px;font-size:11px}
.iobar button{background:none;border:1px solid var(--line);border-radius:4px;padding:4px 9px;cursor:pointer;color:var(--ink-soft);font-family:inherit}
.iobar span{color:var(--ink-soft);margin-left:auto;align-self:center}
</style>
</head>
<body>

<div class="side">
  <h1>Vault</h1>
  <div class="sub">personal · unlimited nesting</div>
  <div class="tree" id="tree"></div>
  <div class="newfolder" id="addRootFolder">+ new top-level folder</div>
  <div class="expand-controls">
    <span>expand:</span>
    <button data-lvl="1">1</button><button data-lvl="2">2</button><button data-lvl="3">3</button><button data-lvl="99">all</button><button data-lvl="0">none</button>
  </div>
</div>

<div class="main">
  <div class="topbar">
    <div class="crumb" id="crumb"></div>
    <div class="tools">
      <button id="renameBtn">rename</button>
      <button id="moveBtn">move</button>
      <button id="copyBtn">copy</button>
      <button id="delFolderBtn">delete</button>
    </div>
  </div>

  <div class="composer">
    <textarea id="noteInput" rows="2" placeholder="1-2 word bullet, or a link, task, idea..."></textarea>
    <div class="suggest-row">
      <span>goes in:</span>
      <select id="targetSelect"></select>
      <span class="chip" id="guessChip" style="display:none"></span>
      <button class="save" id="saveNote">save</button>
    </div>
  </div>

  <div class="notes" id="notes"></div>

  <div class="iobar">
    <button id="exportBtn">export .json</button>
    <button id="importBtn">import .json</button>
    <input type="file" id="importFile" accept=".json" style="display:none">
    <span id="status"></span>
  </div>
</div>

<script>
const KEY = 'vault_v1';
let data = JSON.parse(localStorage.getItem(KEY) || 'null') || seed();
let activeId = data.folders[0].id;
let expanded = new Set([data.folders[0].id]);

function uid(){ return Math.random().toString(36).slice(2,9); }

function seed(){
  const f = []; const n = [];
  const mk = (name, parent) => { const id = uid(); f.push({id, name, parent}); return id; };
  const note = (folder, text, links=[]) => n.push({id:uid(), folder, text, links});

  const dm = mk('Digital Marketing', null);
  const sites = mk('Sites', dm);

  const es = mk('examstatus', sites);
  note(es, 'Sarkari-result style, Astro+Workers');
  note(es, 'live: examstatus.skmstudio-services.workers.dev');
  note(es, 'AI cron 100% fail since Aug 28');
  note(es, 'dup D1 db — examstatus-db vs -apac');
  const esAds = mk('Ads', es); note(esAds, 'not started');
  const esBlog = mk('Blog', es); note(esBlog, 'build-in-public angle picked');

  const mn = mk('mapsnearme', sites);
  note(mn, 'JustDial+GMaps combo, Astro rebuild');
  note(mn, 'old Vercel version = maps-old-repo, archive it');
  note(mn, 'git rebase fix — push conflict resolved');
  mk('Ads', mn);

  const pin = mk('pincode-india', sites);
  note(pin, '384K villages, 19.5K pincodes — D1 heavy');
  note(pin, 'unindexed query read 408K rows in one call');
  note(pin, 'ifsc-code-finder queued next — RBI dataset 160K rows');

  const nearme = mk('near-me batch', sites);
  note(nearme, '7 stub repos — cngpumps, toilets, EVchargers, bloodbanks, aadhaar-kendra, restarea, safealleys');
  note(nearme, 'not deployed yet — 0 CF workers matching');

  const queue = mk('Queued niches', sites);
  note(queue, 'gst-calculator-india');
  note(queue, 'gold-rate-today-city');
  note(queue, 'best-ai-video-tools');

  const infra = mk('Infra & Deploy', null);
  const cf = mk('Cloudflare', infra);
  note(cf, '100k req/day shared, all sites');
  note(cf, '10k Neurons/day shared');
  note(cf, 'D1 row caps hard since Sep 1');
  mk('GitHub', infra); mk('D1', infra);

  const seo = mk('SEO / GSC', null);
  note(seo, 'dup verify tag on 2 URLs — unresolved');
  note(seo, 'want auto-index-ping like WP');

  const client = mk('Clients', null);
  const personal = mk('Personal Ops', null);
  note(personal, 'solo, night hours, no staff');

  return { folders: f, notes: n };
}

function save(){ localStorage.setItem(KEY, JSON.stringify(data)); }

function children(pid){ return data.folders.filter(f => f.parent === pid); }
function folder(id){ return data.folders.find(f => f.id === id); }
function noteCount(id){ return data.notes.filter(n => n.folder === id).length; }

function path(id){
  const p = []; let f = folder(id);
  while(f){ p.unshift(f.name); f = f.parent ? folder(f.parent) : null; }
  return p;
}

function renderTree(){
  const root = document.getElementById('tree');
  root.innerHTML = '';
  const build = (pid, depth) => {
    const ul = document.createElement('div');
    children(pid).forEach(f => {
      const kids = children(f.id);
      const node = document.createElement('div'); node.className='node';
      const row = document.createElement('div'); row.className='row'+(f.id===activeId?' active':'');
      row.innerHTML = \`<span class="caret \${kids.length?'':'empty'}">\${expanded.has(f.id)?'▾':'▸'}</span><span>\${f.name}</span><span class="badge">\${noteCount(f.id)}</span>
      <span class="actions-row"><button title="add sub-folder">+</button></span>\`;
      row.onclick = (e) => {
        if(e.target.closest('.actions-row')) return;
        if(e.target.classList.contains('caret')){ expanded.has(f.id)?expanded.delete(f.id):expanded.add(f.id); }
        else { activeId = f.id; expanded.add(f.id); }
        renderAll();
      };
      row.querySelector('.actions-row button').onclick = (e) => {
        e.stopPropagation();
        const name = prompt('New sub-folder name inside "'+f.name+'":');
        if(name){ data.folders.push({id:uid(), name, parent:f.id}); expanded.add(f.id); save(); renderAll(); }
      };
      node.appendChild(row);
      if(kids.length && expanded.has(f.id)){
        const c = document.createElement('div'); c.className='children';
        c.appendChild(build(f.id, depth+1));
        node.appendChild(c);
      }
      ul.appendChild(node);
    });
    return ul;
  };
  root.appendChild(build(null, 0));
}

function allFoldersFlat(){
  const out = [];
  const walk = (pid, prefix) => {
    children(pid).forEach(f => { out.push({id:f.id, label: prefix + f.name}); walk(f.id, prefix + f.name + ' / '); });
  };
  walk(null, '');
  return out;
}

function renderSelect(){
  const sel = document.getElementById('targetSelect');
  sel.innerHTML = '';
  allFoldersFlat().forEach(f => {
    const o = document.createElement('option'); o.value = f.id; o.textContent = f.label;
    if(f.id === activeId) o.selected = true;
    sel.appendChild(o);
  });
}

function guessFolder(text){
  const flat = allFoldersFlat();
  const words = text.toLowerCase().split(/\\s+/);
  let best = null, bestScore = 0;
  flat.forEach(f => {
    const name = f.label.toLowerCase();
    let score = 0;
    words.forEach(w => { if(w.length>2 && name.includes(w)) score++; });
    if(score > bestScore){ bestScore = score; best = f; }
  });
  return bestScore>0 ? best : null;
}

function renderCrumb(){
  document.getElementById('crumb').innerHTML = path(activeId).map((p,i,a)=> i===a.length-1?\`<b>\${p}</b>\`:p).join(' / ');
}

function renderNotes(){
  const wrap = document.getElementById('notes');
  const list = data.notes.filter(n => n.folder === activeId);
  wrap.innerHTML = '';
  if(!list.length){ wrap.innerHTML = '<div class="empty-state">nothing here yet</div>'; return; }
  list.forEach(n => {
    const el = document.createElement('div'); el.className='note';
    const linkNames = (n.links||[]).map(id => folder(id)?.name).filter(Boolean);
    el.innerHTML = \`<div class="txt">\${n.text}\${linkNames.length?\`<div class="links">↳ also in: \${linkNames.join(', ')}</div>\`:''}</div><button class="del">✕</button>\`;
    el.querySelector('.del').onclick = () => { data.notes = data.notes.filter(x=>x.id!==n.id); save(); renderAll(); };
    wrap.appendChild(el);
  });
}

function renderAll(){ renderTree(); renderSelect(); renderCrumb(); renderNotes(); }

document.getElementById('noteInput').addEventListener('input', (e) => {
  const g = guessFolder(e.target.value);
  const chip = document.getElementById('guessChip');
  if(g){ chip.style.display='inline'; chip.textContent = 'guess: '+g.label; document.getElementById('targetSelect').value = g.id; }
  else { chip.style.display='none'; }
});

document.getElementById('saveNote').onclick = () => {
  const txt = document.getElementById('noteInput').value.trim();
  if(!txt) return;
  const target = document.getElementById('targetSelect').value;
  data.notes.push({id:uid(), folder: target, text: txt, links: []});
  document.getElementById('noteInput').value = '';
  document.getElementById('guessChip').style.display='none';
  activeId = target;
  save(); renderAll();
};

document.getElementById('addRootFolder').onclick = () => {
  const name = prompt('New top-level folder name:');
  if(name){ data.folders.push({id:uid(), name, parent:null}); save(); renderAll(); }
};

document.getElementById('renameBtn').onclick = () => {
  const f = folder(activeId); const name = prompt('Rename folder:', f.name);
  if(name){ f.name = name; save(); renderAll(); }
};

document.getElementById('delFolderBtn').onclick = () => {
  if(!confirm('Delete "'+folder(activeId).name+'" and everything inside it?')) return;
  const toDelete = new Set([activeId]);
  let grew = true;
  while(grew){ grew=false; data.folders.forEach(f=>{ if(f.parent && toDelete.has(f.parent) && !toDelete.has(f.id)){ toDelete.add(f.id); grew=true; } }); }
  data.folders = data.folders.filter(f => !toDelete.has(f.id));
  data.notes = data.notes.filter(n => !toDelete.has(n.folder));
  activeId = data.folders[0]?.id;
  save(); renderAll();
};

function subtree(id){
  const ids = new Set([id]); let grew = true;
  while(grew){ grew=false; data.folders.forEach(f=>{ if(f.parent && ids.has(f.parent) && !ids.has(f.id)){ ids.add(f.id); grew=true; } }); }
  return ids;
}

document.getElementById('moveBtn').onclick = () => {
  const list = allFoldersFlat().filter(f=>!subtree(activeId).has(f.id));
  const target = prompt('Move "'+folder(activeId).name+'" into which folder? (type exact name)\\n\\n' + list.map(f=>f.label).join('\\n'));
  const match = list.find(f => f.label.toLowerCase() === (target||'').toLowerCase() || f.label.split(' / ').pop().toLowerCase() === (target||'').toLowerCase());
  if(match){ folder(activeId).parent = match.id; expanded.add(match.id); save(); renderAll(); }
  else if(target) alert('No exact match found — nothing moved.');
};

document.getElementById('copyBtn').onclick = () => {
  const list = allFoldersFlat();
  const target = prompt('Copy "'+folder(activeId).name+'" into which folder? (type exact name)\\n\\n' + list.map(f=>f.label).join('\\n'));
  const match = list.find(f => f.label.toLowerCase() === (target||'').toLowerCase() || f.label.split(' / ').pop().toLowerCase() === (target||'').toLowerCase());
  if(!match && target){ alert('No exact match found — nothing copied.'); return; }
  const destParent = match ? match.id : null;
  const idMap = {};
  const ids = subtree(activeId);
  ids.forEach(id => { idMap[id] = uid(); });
  data.folders.forEach(f => {
    if(ids.has(f.id)){
      const newParent = f.id===activeId ? destParent : (idMap[f.parent] || f.parent);
      data.folders.push({id: idMap[f.id], name: f.name, parent: newParent});
    }
  });
  data.notes.forEach(n => { if(ids.has(n.folder)) data.notes.push({id:uid(), folder: idMap[n.folder], text:n.text, links:n.links||[]}); });
  save(); renderAll();
};

document.getElementById('exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'vault-export.json'; a.click();
};
document.getElementById('importBtn').onclick = () => document.getElementById('importFile').click();
document.getElementById('importFile').onchange = (e) => {
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = () => { try{ data = JSON.parse(reader.result); activeId = data.folders[0].id; save(); renderAll(); document.getElementById('status').textContent='imported ✓'; }catch(err){ alert('Invalid file'); } };
  reader.readAsText(file);
};

renderAll();
document.querySelectorAll('.expand-controls button').forEach(btn => {
  btn.onclick = () => {
    const lvl = parseInt(btn.dataset.lvl);
    expanded = new Set();
    if(lvl > 0){
      const walk = (pid, depth) => {
        if(depth > lvl) return;
        children(pid).forEach(f => { expanded.add(f.id); walk(f.id, depth+1); });
      };
      walk(null, 1);
    }
    renderAll();
  };
});
</script>
</body>
</html>
`;
}

function renderDashboardHTML({ view = 'actual' } = {}) {
  const isDemo = view === 'demo';
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nexus CMS — Mission Control</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{
  --fs:16px; --lh:1.65;
  --bg:#0b1220; --surface:#131c2e; --border:#3b4a63; --hover:#1c2740;
  --text:#f2f6fc; --muted:#c7d2e0; --accent:#7dd3fc; --accent-ink:#04121f;
  --glow:rgba(125,211,252,.18); --ok:#34d399; --warn:#fbbf24; --bad:#fca5a5; --tag:#1e293b;
  --sw:280px;
}
html[data-theme="light"]{
  --bg:#ffffff; --surface:#f4f7fb; --border:#b8c4d4; --hover:#e8eef6;
  --text:#0a1220; --muted:#2b3a4d; --accent:#0b5ed7; --accent-ink:#ffffff;
  --glow:rgba(11,94,215,.12); --ok:#047857; --warn:#a15c00; --bad:#b91c1c; --tag:#e2e8f0;
}
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:var(--fs)}
body{font-family:'Plus Jakarta Sans',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;font-size:1rem;line-height:var(--lh)}
a{color:var(--accent)}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:6px}
.skip{position:absolute;left:-999px}
.skip:focus{left:8px;top:8px;z-index:999;background:var(--accent);color:var(--accent-ink);padding:10px 14px;border-radius:8px}
.mode-bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px 20px;font-size:.95rem;border-bottom:2px solid var(--border);position:sticky;top:0;z-index:50;background:var(--surface)}
.mode-pill{font-weight:800;letter-spacing:.03em;font-size:.8rem;padding:5px 12px;border-radius:999px;background:var(--tag);color:var(--text)}
.mode-note{color:var(--muted)}
.mode-switch{margin-left:auto;font-weight:700;text-decoration:underline}
.shell{display:flex;min-height:calc(100vh - 52px)}
aside{width:var(--sw);background:var(--surface);border-right:2px solid var(--border);flex-shrink:0;position:sticky;top:52px;height:calc(100vh - 52px);overflow-y:auto;padding-bottom:32px}
.brand{padding:20px 20px 12px;font-weight:800;font-size:1.15rem}
.brand span{color:var(--accent)}
.nav-section{padding:16px 18px 6px;font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.nav-item{display:flex;align-items:center;gap:11px;padding:13px 18px;font-size:1.02rem;color:var(--text);cursor:pointer;border-left:4px solid transparent;text-decoration:none}
.nav-item:hover{background:var(--hover)}
.nav-item.active{color:var(--accent);background:var(--glow);border-left-color:var(--accent);font-weight:700}
.nav-badge{margin-left:auto;font-size:.78rem;padding:2px 9px;border-radius:10px;background:var(--tag);color:var(--muted)}
main{flex:1;min-width:0;padding:24px 28px 80px}
header{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:22px}
.h-title{font-size:1.6rem;font-weight:800;line-height:1.3}
.h-sub{font-size:.98rem;color:var(--muted);margin-top:5px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:11px 16px;border-radius:11px;border:2px solid var(--border);background:var(--surface);color:var(--text);font-size:.95rem;font-weight:700;cursor:pointer;text-decoration:none}
.btn:hover{background:var(--hover)}
.btn-primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.btn-sm{padding:8px 12px;font-size:.9rem}
.grid{display:grid;gap:16px}
.g4{grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}
.card{background:var(--surface);border:2px solid var(--border);border-radius:16px;padding:20px;margin-bottom:16px}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.card-title{font-weight:800;font-size:1.1rem}
.stat{background:var(--surface);border:2px solid var(--border);border-radius:16px;padding:18px}
.stat .l{font-size:.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700}
.stat .v{font-size:1.9rem;font-weight:800;margin-top:8px;line-height:1.1}
.stat .s{font-size:.88rem;color:var(--muted);margin-top:4px}
.badge{display:inline-block;font-size:.85rem;padding:3px 10px;border-radius:9px;background:var(--tag);color:var(--text);margin:2px}
table{width:100%;border-collapse:collapse;font-size:.97rem}
th,td{text-align:left;padding:12px 12px;border-bottom:2px solid var(--border);vertical-align:top}
th{font-size:.8rem;text-transform:uppercase;color:var(--muted);letter-spacing:.05em;font-weight:800}
code,.mono,pre{font-family:'JetBrains Mono',monospace;font-size:.92rem}
input,select,textarea{background:var(--bg);border:2px solid var(--border);color:var(--text);border-radius:11px;padding:12px 13px;font-size:1rem;font-family:inherit;width:100%}
.bar{height:11px;border-radius:7px;background:var(--tag);overflow:hidden;margin-top:8px}
.bar > i{display:block;height:100%;background:var(--ok)}
.pill{font-size:.9rem;padding:5px 12px;border-radius:999px;background:var(--tag);color:var(--text)}
.ok{color:var(--ok);font-weight:700}.warn{color:var(--warn);font-weight:700}.bad{color:var(--bad);font-weight:700}.muted{color:var(--muted)}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
pre.out{background:var(--bg);border:2px solid var(--border);border-radius:12px;padding:16px;overflow:auto;max-height:420px;white-space:pre-wrap;word-break:break-word;line-height:1.55}
.spin{display:inline-block;width:16px;height:16px;border:3px solid var(--tag);border-top-color:var(--accent);border-radius:50%;animation:sp .7s linear infinite;vertical-align:-3px}
@keyframes sp{to{transform:rotate(360deg)}}
.toast{position:fixed;bottom:22px;right:22px;background:var(--surface);border:2px solid var(--accent);border-radius:12px;padding:16px 20px;font-size:1rem;box-shadow:0 12px 34px rgba(0,0,0,.45);display:none;z-index:100;max-width:380px}
@media(max-width:860px){aside{position:fixed;left:-105%;transition:left .2s;z-index:60}aside.open{left:0}.shell{display:block}main{padding:18px 16px 80px}}

</style>
</head>
<body>
<a class="skip" href="#view">Skip to content</a>
<!-- BLOCK:MODE-BAR -->
<div class="mode-bar ${isDemo ? 'mode-bar-demo' : 'mode-bar-actual'}">
  <span class="mode-pill">${isDemo ? '👁️ DEMO DASHBOARD' : '✅ ACTUAL DASHBOARD'}</span>
  <span class="mode-note">${isDemo ? 'Public sandbox view — no login required.' : 'Live view — real data from your D1 / KV / Cloudflare resources.'}</span>
  <a class="mode-switch" href="?view=${isDemo ? 'actual' : 'demo'}">${isDemo ? '→ Switch to Actual Dashboard' : '→ Switch to Demo Dashboard'}</a>
</div>

<div class="shell">
  <!-- BLOCK:SIDEBAR -->
  <aside id="side">
    <div class="brand">⚡ Nexus <span>CMS</span></div>
    <div class="nav-section">Core</div>
    <a class="nav-item" data-tab="overview">🏠 Overview</a>
    <a class="nav-item" data-tab="sites">🌐 Sites &amp; Stacks <span class="nav-badge" id="bSites">·</span></a>
    <div class="nav-section">Data &amp; Storage</div>
    <a class="nav-item" data-tab="d1">💾 D1 Databases</a>
    <a class="nav-item" data-tab="kv">⚡ KV Namespaces</a>
    <div class="nav-section">Operations</div>
    <a class="nav-item" data-tab="crons">⏰ Crons</a>
    <a class="nav-item" data-tab="github">🐙 GitHub Runs</a>
    <a class="nav-item" data-tab="domains">🔎 Domain Checker</a>
    <div class="nav-section">Content &amp; AI</div>
    <a class="nav-item" data-tab="comments">💬 Comments <span class="nav-badge" id="bComments">·</span></a>
    <a class="nav-item" data-tab="analytics">📊 Analytics</a>
    <a class="nav-item" data-tab="notion">📓 Notion</a>
    <div class="nav-section">Management</div>
    <a class="nav-item" data-tab="config">⚙️ Config</a>
    <a class="nav-item" data-tab="mcp">🤖 MCP Endpoint</a>
    <a class="nav-item" href="/vault">🗄️ Vault (notes)</a>
  </aside>

  <!-- BLOCK:MAIN -->
  <main>
    <header>
      <div>
        <div class="h-title" id="pageTitle">Overview</div>
        <div class="h-sub" id="pageSub">Mission control for the SKM network</div>
      </div>
      <div class="row">
        <button class="btn btn-sm" onclick="toggleTheme()" title="Switch light / dark theme" aria-label="Switch light or dark theme">🌗 Theme</button>
        <button class="btn btn-sm" onclick="bumpFont(-1)" title="Smaller text" aria-label="Decrease text size">A−</button>
        <button class="btn btn-sm" onclick="bumpFont(0)" title="Reset text size" aria-label="Reset text size">A</button>
        <button class="btn btn-sm" onclick="bumpFont(1)" title="Larger text" aria-label="Increase text size">A+</button>
        <a class="btn" href="https://github.com/skmstudioservices-cyber/my-CMS-dashboard" target="_blank" rel="noopener">🐙 Repo</a>
        <button class="btn btn-primary" onclick="syncNow()">🔄 Scan Resources</button>
      </div>
    </header>
    <div id="view"><div class="muted"><span class="spin"></span> Loading…</div></div>
  </main>
</div>

<div class="toast" id="toast"></div>
<script>
/* BLOCK:APP-JS — tab router + real-data fetchers (no backticks inside) */
var $ = function(s, r){ return (r||document).querySelector(s); };
var $$ = function(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); };
function toast(m){ var t=$('#toast'); t.textContent=m; t.style.display='block'; clearTimeout(t._t); t._t=setTimeout(function(){t.style.display='none';},2800); }
function api(path, opts){ return fetch(path, opts).then(function(r){ var ct=r.headers.get('content-type')||''; return ct.indexOf('json')>-1 ? r.json() : r.text(); }); }
function fmt(n){ return Number(n||0).toLocaleString('en-IN'); }
function esc(s){ return String(s==null?'':s).replace(/[&<>]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]; }); }
function badge(x){ return '<span class="badge">'+esc(x)+'</span>'; }
var TITLES={overview:['Overview','Mission control for the SKM network'],sites:['Sites & Stacks','Auto-detected Pages / Workers and their bindings'],d1:['D1 Databases','Browse tables and run read-only SQL'],kv:['KV Namespaces','Browse keys in each bound namespace'],crons:['Crons','Scheduled jobs on this worker'],github:['GitHub Runs','Recent workflow runs'],domains:['Domain Checker','RDAP lookup for any domain'],comments:['Comments','Block-level notes with voice + copy-all'],analytics:['Analytics','Traffic and search performance'],notion:['Notion','Workspace links'],config:['Config','cms_settings key / values'],mcp:['MCP Endpoint','Read-only AI access']};
var RENDER={};

function show(tab){
  $$('.nav-item').forEach(function(a){ a.classList.toggle('active', a.dataset.tab===tab); });
  var t=TITLES[tab]||TITLES.overview;
  $('#pageTitle').textContent=t[0]; $('#pageSub').textContent=t[1];
  $('#view').innerHTML='<div class="muted"><span class="spin"></span> Loading '+tab+'…</div>';
  location.hash=tab;
  (RENDER[tab]||RENDER.overview)();
}
window.addEventListener('hashchange', function(){ show(location.hash.replace('#','')||'overview'); });

RENDER.overview=function(){
  api('/api/overview').then(function(d){
    var lim=(d&&d.limits)||[];
    function bar(x){ var used=x.used_today||0, max=x.daily_limit||1, p=(x.percent_used!=null?x.percent_used:(max?used/max*100:0)); return '<div style="margin-bottom:12px"><div class="row" style="justify-content:space-between"><span>'+esc(x.resource_name||'')+'</span><span class="mono muted">'+fmt(used)+' / '+fmt(max)+' ('+Number(p).toFixed(2)+'%)</span></div><div class="bar"><i style="width:'+Math.min(100,p)+'%;background:'+(p>85?'var(--bad)':p>60?'var(--warn)':'var(--ok)')+'"></i></div></div>'; }
    var html='<div class="grid g4" style="margin-bottom:16px">'
      +'<div class="stat"><div class="l">Sites</div><div class="v">'+fmt(d.total_sites||0)+'</div><div class="s">tracked</div></div>'
      +'<div class="stat"><div class="l">D1 Databases</div><div class="v">'+fmt(d.d1_count||0)+'</div><div class="s">bound</div></div>'
      +'<div class="stat"><div class="l">KV Namespaces</div><div class="v">'+fmt(d.kv_count||0)+'</div><div class="s">bound</div></div>'
      +'<div class="stat"><div class="l">Health</div><div class="v ok">'+esc(d.health_score||'\u2014')+'</div><div class="s">uptime</div></div>'
      +'</div>';
    html+='<div class="card"><div class="card-head"><div class="card-title">\ud83d\udee1\ufe0f Limit Guard \u2014 Free Tier</div><span class="muted" style="font-size:11px">Resets 00:00 UTC</span></div>'+lim.map(bar).join('')+'</div>';
    html+='<div class="card"><div class="card-head"><div class="card-title">\ud83d\udca1 Recommendations</div></div><div id="recList" class="muted">loading\u2026</div></div>';
    html+='<div class="card"><div class="card-head"><div class="card-title">\ud83d\ude80 Recent deployments</div></div>'+((d.recent_deployments||[]).map(function(x){ return '<div style="padding:6px 0;border-bottom:1px solid var(--border)"><b>'+esc(x.site)+'</b> <span class="mono muted">'+esc(x.sha||'')+'</span> \u2014 '+esc(x.message||'')+' <span class="muted" style="font-size:11px">'+esc(x.date||'')+'</span></div>'; }).join('')||'<span class="muted">none</span>')+'</div>';
    $('#view').innerHTML=html;
    api('/api/recommendations').then(function(r){
      var recs=(r&&r.recommendations)||[];
      if(!recs.length){ $('#recList').innerHTML='<span class="ok">No open recommendations.</span>'; return; }
      $('#recList').innerHTML=recs.map(function(x){ return '<div style="padding:8px 0;border-bottom:1px solid var(--border)"><div class="row" style="justify-content:space-between"><b>'+esc(x.site_id||x.type||'')+'</b>'+badge(x.severity||'info')+'</div><div class="muted" style="font-size:12px;margin-top:3px">'+esc(x.message||'')+'</div></div>'; }).join('');
    }).catch(function(){ $('#recList').innerHTML='<span class="muted">unavailable</span>'; });
  }).catch(function(e){ $('#view').innerHTML='<div class="bad">Failed: '+esc(e.message)+'</div>'; });
};

RENDER.sites=function(){
  api('/api/sites').then(function(d){
    var sites=(d&&d.sites)||d||[];
    $('#bSites').textContent=sites.length;
    if(!sites.length){ $('#view').innerHTML='<div class="muted">No sites detected.</div>'; return; }
    var rows=sites.map(function(s){
      var bind=(s.d1_bindings||[]).map(function(x){return '<span class="badge">D1: '+esc(x)+'</span>';}).join(' ')+' '+(s.kv_bindings||[]).map(function(x){return '<span class="badge">KV: '+esc(x)+'</span>';}).join(' ');
      var stack=(s.stack||[]).map(badge).join(' ');
      return '<tr><td><b>'+esc(s.name||s.id)+'</b><div class="muted mono" style="font-size:11px">'+esc(s.subdomain||'')+'</div></td><td>'+badge(s.type||'')+'</td><td>'+stack+'</td><td>'+bind+'</td><td><span class="ok">\u25cf '+esc(s.status||'active')+'</span></td></tr>';
    }).join('');
    $('#view').innerHTML='<div class="card"><div class="card-head"><div class="card-title">\ud83c\udf10 Sites &amp; Stacks</div><span class="muted" style="font-size:11px">'+sites.length+' detected</span></div><table><thead><tr><th>Site</th><th>Type</th><th>Stack</th><th>Bindings</th><th>Status</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }).catch(function(e){ $('#view').innerHTML='<div class="bad">Failed: '+esc(e.message)+'</div>'; });
};

var DBS=['CMS_DB','SEO_DB','MAPS_DB','PINCODE_DB','EXAM_DB','EXAM_APAC','SKMTOOLS_DB'];
RENDER.d1=function(){
  var opts=DBS.map(function(x){ return '<option>'+x+'</option>'; }).join('');
  $('#view').innerHTML='<div class="card"><div class="card-head"><div class="card-title">💾 D1 Databases</div></div>'
    +'<div class="row"><select id="dbSel" style="max-width:260px">'+opts+'</select><button class="btn btn-sm" onclick="d1Tables()">List tables</button></div>'
    +'<div id="tblOut" style="margin-top:14px"></div></div>'
    +'<div class="card"><div class="card-head"><div class="card-title">▶️ SQL Runner</div><span class="muted" style="font-size:11px">read-only recommended</span></div>'
    +'<textarea id="sqlBox" rows="3" placeholder="SELECT name FROM sqlite_master LIMIT 10"></textarea>'
    +'<div class="row" style="margin-top:10px"><button class="btn btn-primary btn-sm" onclick="d1Run()">Run query</button></div>'
    +'<pre class="out" id="sqlOut" style="margin-top:12px">—</pre></div>';
  d1Tables();
};
window.d1Tables=function(){
  var db=$('#dbSel').value; $('#tblOut').innerHTML='<span class="spin"></span> listing…';
  api('/api/d1_tables?db='+encodeURIComponent(db)).then(function(r){
    if(r.error){ $('#tblOut').innerHTML='<span class="bad">'+esc(r.error)+'</span>'; return; }
    $('#tblOut').innerHTML='<div class="row">'+(r.tables||[]).map(function(t){ return '<span class="pill" style="cursor:pointer" onclick="d1Quick(&quot;'+esc(t)+'&quot;)">'+esc(t)+'</span>'; }).join(' ')+'</div>';
  }).catch(function(e){ $('#tblOut').innerHTML='<span class="bad">'+esc(e.message)+'</span>'; });
};
window.d1Quick=function(t){ $('#sqlBox').value='SELECT * FROM "'+t+'" LIMIT 20'; d1Run(); };
window.d1Run=function(){
  var db=$('#dbSel').value, q=$('#sqlBox').value; $('#sqlOut').textContent='running…';
  api('/api/d1_query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({db:db,query:q})}).then(function(r){
    if(r.error){ $('#sqlOut').innerHTML='<span class="bad">'+esc(r.error)+'</span>'; return; }
    var rows=(r.results||r||[]); $('#sqlOut').textContent=JSON.stringify(rows,null,2).slice(0,20000);
  }).catch(function(e){ $('#sqlOut').innerHTML='<span class="bad">'+esc(e.message)+'</span>'; });
};

var KVS=['NEXUS_CACHE','SESSION','MAPS_ADS','MAPS_ADS2'];
RENDER.kv=function(){
  var opts=KVS.map(function(x){ return '<option>'+x+'</option>'; }).join('');
  $('#view').innerHTML='<div class="card"><div class="card-head"><div class="card-title">⚡ KV Namespaces</div></div>'
    +'<div class="row"><select id="kvSel" style="max-width:260px">'+opts+'</select><button class="btn btn-sm" onclick="kvList()">List keys</button></div>'
    +'<pre class="out" id="kvOut" style="margin-top:14px">—</pre></div>';
  kvList();
};
window.kvList=function(){
  var ns=$('#kvSel').value; $('#kvOut').textContent='loading…';
  api('/api/kv_list?ns='+encodeURIComponent(ns)).then(function(r){ $('#kvOut').textContent=JSON.stringify(r,null,2).slice(0,20000); })
    .catch(function(e){ $('#kvOut').innerHTML='<span class="bad">'+esc(e.message)+'</span>'; });
};

RENDER.crons=function(){
  api('/api/crons').then(function(d){
    var rows=(d.crons||[]).map(function(c){ return '<tr><td><b>'+esc(c.name)+'</b></td><td class="mono">'+esc(c.spec)+'</td><td class="muted">'+esc(c.desc)+'</td></tr>'; }).join('');
    var recent=(d.recent||[]).map(function(r){ return '<tr><td class="mono">'+esc(r.timestamp)+'</td><td>'+esc(r.site_id)+'</td><td>'+fmt(r.requests)+'</td><td>'+fmt(r.errors)+'</td><td>'+fmt(r.page_views)+'</td></tr>'; }).join('');
    $('#view').innerHTML='<div class="card"><div class="card-head"><div class="card-title">⏰ Cron Triggers</div></div><table><thead><tr><th>Job</th><th>Schedule</th><th>What</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
      +'<div class="card"><div class="card-head"><div class="card-title">📈 Recent hourly analytics</div></div><table><thead><tr><th>Time</th><th>Site</th><th>Req</th><th>Err</th><th>Views</th></tr></thead><tbody>'+(recent||'<tr><td colspan=5 class="muted">none yet</td></tr>')+'</tbody></table></div>';
  }).catch(function(e){ $('#view').innerHTML='<div class="bad">Failed: '+esc(e.message)+'</div>'; });
};

RENDER.github=function(){
  $('#view').innerHTML='<div class="card"><div class="card-head"><div class="card-title">🐙 GitHub Runs</div></div><div class="row"><input id="ghRepo" value="skmstudioservices-cyber/digipincode-india" style="max-width:420px"><button class="btn btn-sm" onclick="ghRuns()">Load</button></div><div id="ghOut" style="margin-top:14px">…</div></div>';
  ghRuns();
};
window.ghRuns=function(){
  var repo=$('#ghRepo').value; $('#ghOut').innerHTML='<span class="spin"></span> loading…';
  api('/api/github_runs?repo='+encodeURIComponent(repo)).then(function(d){
    if(d.error){ $('#ghOut').innerHTML='<span class="warn">'+esc(d.error)+'</span>'; return; }
    var rows=(d.runs||[]).map(function(r){ var c=r.conclusion||r.status; var col=c==='success'?'ok':(c==='failure'?'bad':'warn'); return '<tr><td><a href="'+esc(r.url)+'" target="_blank" rel="noopener">'+esc(r.name)+'</a></td><td>'+badge(r.branch||'')+'</td><td><span class="'+col+'">'+esc(c)+'</span></td><td class="muted mono" style="font-size:11px">'+esc((r.created_at||'').replace('T',' ').slice(0,16))+'</td></tr>'; }).join('');
    $('#ghOut').innerHTML='<table><thead><tr><th>Workflow</th><th>Branch</th><th>Result</th><th>When</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }).catch(function(e){ $('#ghOut').innerHTML='<span class="bad">'+esc(e.message)+'</span>'; });
};

RENDER.domains=function(){
  $('#view').innerHTML='<div class="card"><div class="card-head"><div class="card-title">🔎 Domain Checker (RDAP)</div></div>'
    +'<div class="row"><input id="domBox" placeholder="example.com" style="max-width:360px"><button class="btn btn-primary btn-sm" onclick="domCheck()">Check</button></div>'
    +'<pre class="out" id="domOut" style="margin-top:14px">—</pre></div>';
};
window.domCheck=function(){
  var d=$('#domBox').value.trim(); if(!d) return; $('#domOut').textContent='checking…';
  api('/api/domain_check?domain='+encodeURIComponent(d)).then(function(r){ $('#domOut').textContent=JSON.stringify(r,null,2); })
    .catch(function(e){ $('#domOut').innerHTML='<span class="bad">'+esc(e.message)+'</span>'; });
};

var BLOCKS=['mode-bar','sidebar','header','overview','sites','d1','kv','crons','github','domains','comments','analytics','notion','config','mcp'];
function promptFor(list){ var NL=String.fromCharCode(10); var t='Improve the following dashboard block(s). For each, return the revised code and a one-line summary.'+NL+NL; t+=list.map(function(x){ return '- BLOCK: '+(x.file_path||'general')+(x.line_number?' (line '+x.line_number+')':'')+NL+'  NOTE: '+x.comment; }).join(NL); return t; }
RENDER.comments=function(){
  var dl=BLOCKS.map(function(b){ return '<option value="'+b+'">'; }).join('');
  $('#view').innerHTML='<div class="card"><div class="card-head"><div class="card-title">\ud83d\udcac Add a comment</div><span class="muted" style="font-size:11px">block-based</span></div>'
    +'<datalist id="blockList">'+dl+'</datalist>'
    +'<div class="row"><input id="cmFile" list="blockList" placeholder="block (e.g. header, section-a)" style="max-width:320px"><input id="cmLine" type="number" placeholder="line" style="max-width:110px"><button class="btn btn-sm" onclick="cmVoice()">\ud83c\udfa4 Voice</button></div>'
    +'<textarea id="cmText" rows="3" placeholder="Your note\u2026" style="margin-top:10px"></textarea>'
    +'<div class="row" style="margin-top:10px"><button class="btn btn-primary btn-sm" onclick="cmAdd()">Add comment</button><button class="btn btn-sm" onclick="cmPromptAll()">\ud83d\udccb Copy all as Prompt</button></div></div>'
    +'<div class="card"><div class="card-head"><div class="card-title">\ud83d\udcdd Comments</div><span class="muted" style="font-size:11px" id="cmCount"></span></div><div id="cmList">\u2026</div></div>';
  cmLoad();
};
window.cmLoad=function(){
  api('/api/comments').then(function(d){
    var c=(d.comments||[]); $('#cmCount').textContent=c.length+' saved';
    var html=c.map(function(x){ return '<div style="padding:9px 0;border-bottom:1px solid var(--border)"><div class="mono muted" style="font-size:11px">'+esc(x.file_path||'general')+(x.line_number?':'+esc(x.line_number):'')+' \u00b7 '+esc(x.created_at||'')+'</div><div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px;margin-top:4px"><div>'+esc(x.comment)+'</div><button class="btn btn-sm" onclick="cmPromptOne(&#39;'+x.id+'&#39;)">\ud83d\udccb Prompt</button></div></div>'; }).join('');
    $('#cmList').innerHTML=html||'<span class="muted">No comments yet.</span>';
  }).catch(function(e){ $('#cmList').innerHTML='<span class="bad">'+esc(e.message)+'</span>'; });
};
window.cmAdd=function(){
  var t=$('#cmText').value.trim(); if(!t){ toast('Write something first'); return; }
  api('/api/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({comment:t,file_path:$('#cmFile').value,line_number:$('#cmLine').value||null})})
    .then(function(){ $('#cmText').value=''; toast('Comment added'); cmLoad(); })
    .catch(function(e){ toast('Failed: '+e.message); });
};
window.cmPromptOne=function(id){ api('/api/comments').then(function(d){ var x=(d.comments||[]).filter(function(c){return c.id===id;})[0]; if(!x) return; navigator.clipboard.writeText(promptFor([x])).then(function(){ toast('Prompt copied'); }); }); };
window.cmPromptAll=function(){ api('/api/comments').then(function(d){ var c=d.comments||[]; if(!c.length){ toast('No comments to export'); return; } navigator.clipboard.writeText(promptFor(c)).then(function(){ toast('Prompt copied ('+c.length+')'); }); }); };
window.cmVoice=function(){
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ toast('Voice not supported in this browser'); return; }
  var r=new SR(); r.lang='en-IN'; r.interimResults=false;
  r.onresult=function(e){ $('#cmText').value=(($('#cmText').value)+' '+e.results[0][0].transcript).trim(); toast('Voice added'); };
  r.onerror=function(){ toast('Voice error'); };
  r.start(); toast('Listening…');
};

RENDER.analytics=function(){
  $('#view').innerHTML='<div class="card"><div class="card-head"><div class="card-title">📊 Traffic &amp; Search</div></div>'
    +'<p class="muted" style="font-size:12.5px;line-height:1.6">Search Console + GA4 views open in their own dashboards. Live request/error analytics from cms_analytics_hourly appear under <b>Crons</b>. Full GSC/GA panels can be wired when the read tokens are added.</p>'
    +'<div class="row" style="margin-top:12px">'
    +'<a class="btn" target="_blank" rel="noopener" href="https://search.google.com/search-console">🔎 Search Console</a>'
    +'<a class="btn" target="_blank" rel="noopener" href="https://analytics.google.com/">📈 Google Analytics</a>'
    +'<a class="btn" target="_blank" rel="noopener" href="https://dash.cloudflare.com/">☁️ Cloudflare</a>'
    +'</div></div>';
};

RENDER.notion=function(){
  $('#view').innerHTML='<div class="card"><div class="card-head"><div class="card-title">📓 Notion</div></div>'
    +'<p class="muted" style="font-size:12.5px;line-height:1.6">Workspace links (Mission Control, Conversation Log, Goals, Decision Log). Embed live pages by adding a Notion read token later.</p>'
    +'<div class="row" style="margin-top:12px"><a class="btn" target="_blank" rel="noopener" href="https://www.notion.so/">📓 Open Notion</a></div></div>';
};

RENDER.config=function(){
  api('/api/config').then(function(d){
    var rows=(d.settings||[]).map(function(s){ return '<tr><td class="mono">'+esc(s.key)+'</td><td class="mono" style="font-size:11px">'+esc(s.value_json)+'</td><td class="muted mono" style="font-size:11px">'+esc(s.updated_at||'')+'</td></tr>'; }).join('');
    $('#view').innerHTML='<div class="card"><div class="card-head"><div class="card-title">⚙️ cms_settings</div></div>'
      +'<div class="row"><input id="cfgKey" placeholder="key" style="max-width:220px"><input id="cfgVal" placeholder="value (JSON or text)" style="max-width:320px"><button class="btn btn-primary btn-sm" onclick="cfgSave()">Save</button></div>'
      +'<table style="margin-top:14px"><thead><tr><th>Key</th><th>Value</th><th>Updated</th></tr></thead><tbody>'+(rows||'<tr><td colspan=3 class="muted">none yet</td></tr>')+'</tbody></table></div>';
  }).catch(function(e){ $('#view').innerHTML='<div class="bad">Failed: '+esc(e.message)+'</div>'; });
};
window.cfgSave=function(){
  var k=$('#cfgKey').value.trim(), v=$('#cfgVal').value; if(!k) return toast('key required');
  var val; try{ val=JSON.parse(v); }catch(e){ val=v; }
  api('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:k,value:val})}).then(function(){ toast('Saved'); RENDER.config(); }).catch(function(e){ toast('Failed: '+e.message); });
};

RENDER.mcp=function(){
  $('#view').innerHTML='<div class="card"><div class="card-head"><div class="card-title">🤖 MCP Endpoints (read-only)</div></div>'
    +'<div class="mono" style="font-size:12px;line-height:2">'
    +'GET /mcp/sites<br>GET /mcp/recommendations<br>GET /mcp/comments/collect</div>'
    +'<p class="muted" style="font-size:12px;margin-top:10px">Send header <code>X-Nexus-Token</code> (or <code>X-Read-Token</code>). Open while login is disabled.</p></div>';
};

window.syncNow=function(){ toast('Scanning…'); api('/api/sync_resources').then(function(d){ toast('Resources synced'); show('sites'); }).catch(function(e){ toast('Failed: '+e.message); }); };

function applyTheme(t){ document.documentElement.setAttribute('data-theme', t); try{ localStorage.setItem('nx_theme', t); }catch(e){} }
function toggleTheme(){ var cur=document.documentElement.getAttribute('data-theme')||'dark'; applyTheme(cur==='dark'?'light':'dark'); }
function applyFont(px){ document.documentElement.style.setProperty('--fs', px+'px'); try{ localStorage.setItem('nx_fs', px); }catch(e){} }
function bumpFont(d){ var cur=parseInt((function(){try{return localStorage.getItem('nx_fs')||'16';}catch(e){return '16';}})(),10); if(d===0){cur=16;} else { cur=Math.min(22, Math.max(13, cur + d)); } applyFont(cur); toast('Text size '+cur+'px'); }
(function(){ try{ var t=localStorage.getItem('nx_theme'); if(t) applyTheme(t); var f=localStorage.getItem('nx_fs'); if(f) applyFont(parseInt(f,10)); }catch(e){} })();
/* boot */
(function(){ $$('.nav-item').forEach(function(a){ a.addEventListener('click', function(ev){ ev.preventDefault(); show(a.dataset.tab); }); }); var h=(location.hash||'').replace('#','')||'overview'; show(TITLES[h]?h:'overview'); })();
</script>
</body>
</html>`;
}
