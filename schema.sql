-- =====================================================================
-- Nexus CMS Dashboard - D1 SQLite Database Schema (cms-db)
-- =====================================================================

-- 1. Auto-detected Sites (Cloudflare Pages, Workers, Custom)
CREATE TABLE IF NOT EXISTS cms_sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL, -- 'pages', 'worker', 'repo', 'external'
  framework TEXT,     -- 'astro', 'nextjs', 'remix', 'vanilla', etc.
  repo TEXT,          -- 'skmstudioservices-cyber/repo-name'
  subdomain TEXT,     -- e.g. 'mapsnearme.pages.dev' or custom domain
  stack TEXT,         -- JSON array: ["Astro", "D1", "KV", "Supabase"]
  d1_bindings TEXT,   -- JSON array of bound D1 DBs
  kv_bindings TEXT,   -- JSON array of bound KV namespaces
  env_vars TEXT,      -- JSON array/object of detected env keys
  custom_domains TEXT,-- JSON array of custom domains
  first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_checked DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active' -- 'active', 'warning', 'down', 'paused'
);

-- 2. Design Templates & Layout Blocks
CREATE TABLE IF NOT EXISTS cms_templates (
  id TEXT PRIMARY KEY,
  site_id TEXT,
  template_type TEXT NOT NULL, -- 'header', 'footer', 'hero', 'map', 'ad_slot', 'seo_meta', 'custom'
  name TEXT NOT NULL,
  html TEXT,
  css TEXT,
  is_reusable BOOLEAN DEFAULT 1,
  theme TEXT DEFAULT 'modern', -- 'modern', 'retro-trust', 'flexifunnels', 'mapsnearme'
  FOREIGN KEY (site_id) REFERENCES cms_sites(id)
);

-- 3. Block-based Content per Site
CREATE TABLE IF NOT EXISTS cms_content (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  template_id TEXT,
  block_type TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES cms_sites(id),
  FOREIGN KEY (template_id) REFERENCES cms_templates(id)
);

-- 4. File Comments & Comment Collector (TODO/FIXME collector for AI tools)
CREATE TABLE IF NOT EXISTS cms_comments (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_number INTEGER,
  comment TEXT NOT NULL,
  status TEXT DEFAULT 'open', -- 'open', 'resolved', 'exported'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES cms_sites(id)
);

-- 5. Auto-audit Recommendations Engine
CREATE TABLE IF NOT EXISTS cms_recommendations (
  id TEXT PRIMARY KEY,
  site_id TEXT,
  type TEXT NOT NULL,         -- 'seo', 'security', 'limits', 'bindings', 'dns'
  severity TEXT DEFAULT 'medium', -- 'critical', 'high', 'medium', 'low', 'info'
  message TEXT NOT NULL,
  action TEXT,
  status TEXT DEFAULT 'pending', -- 'pending', 'resolved', 'dismissed'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES cms_sites(id)
);

-- 6. Aggregated Hourly Analytics
CREATE TABLE IF NOT EXISTS cms_analytics_hourly (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  timestamp DATETIME NOT NULL,
  requests INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  page_views INTEGER DEFAULT 0,
  cache_ratio REAL DEFAULT 0.0,
  FOREIGN KEY (site_id) REFERENCES cms_sites(id)
);

-- 7. Log Patterns & Anomaly Baseline Detection
CREATE TABLE IF NOT EXISTS cms_log_patterns (
  id TEXT PRIMARY KEY,
  site_id TEXT,
  pattern_type TEXT NOT NULL, -- 'error', 'traffic_spike', 'rate_limit', 'slow_query'
  pattern_hash TEXT NOT NULL,
  occurrence_count INTEGER DEFAULT 1,
  first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  sample_message TEXT,
  severity TEXT DEFAULT 'warning',
  FOREIGN KEY (site_id) REFERENCES cms_sites(id)
);

-- 8. Unified Deployments & GitHub Push History
CREATE TABLE IF NOT EXISTS cms_deployments (
  id TEXT PRIMARY KEY,
  site_id TEXT,
  source TEXT NOT NULL,      -- 'cms_push', 'github_direct', 'ai_tool', 'pages_autodeploy'
  commit_sha TEXT,
  commit_message TEXT,
  author TEXT,
  files_changed TEXT,       -- JSON array of file paths
  status TEXT DEFAULT 'success',
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  rollback_link TEXT,
  trigger TEXT DEFAULT 'manual', -- 'manual', 'cron', 'webhook', 'git_push'
  FOREIGN KEY (site_id) REFERENCES cms_sites(id)
);

-- 9. Planner & Site Tasks
CREATE TABLE IF NOT EXISTS cms_todos (
  id TEXT PRIMARY KEY,
  site_id TEXT,
  task TEXT NOT NULL,
  priority TEXT DEFAULT 'medium', -- 'urgent', 'high', 'medium', 'low'
  due_date DATE,
  status TEXT DEFAULT 'pending',  -- 'pending', 'in_progress', 'completed'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES cms_sites(id)
);

-- 10. Planner Calendar & Milestones
CREATE TABLE IF NOT EXISTS cms_calendar (
  id TEXT PRIMARY KEY,
  site_id TEXT,
  event_type TEXT NOT NULL, -- 'deploy', 'ssl_renewal', 'content_drop', 'backup'
  title TEXT NOT NULL,
  date DATE NOT NULL,
  metadata TEXT,
  FOREIGN KEY (site_id) REFERENCES cms_sites(id)
);

-- 11. Connected Accounts (GitHub, Cloudflare, Supabase, Vercel, GSC)
CREATE TABLE IF NOT EXISTS cms_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL, -- 'cloudflare', 'github', 'supabase', 'vercel', 'gsc'
  account_name TEXT NOT NULL,
  connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  metadata_json TEXT
);

-- 12. CMS Global Settings
CREATE TABLE IF NOT EXISTS cms_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 13. MCP Endpoint Access Log (for AI Agent tool usage tracking)
CREATE TABLE IF NOT EXISTS cms_mcp_access (
  id TEXT PRIMARY KEY,
  token_id TEXT,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT
);

-- 14. Real-time Limit Guard Usage (Free Tier Tracking)
CREATE TABLE IF NOT EXISTS cms_limit_usage (
  id TEXT PRIMARY KEY,
  resource_name TEXT NOT NULL UNIQUE, -- 'd1_reads', 'd1_writes', 'kv_reads', 'kv_writes', 'worker_requests'
  used_today INTEGER DEFAULT 0,
  daily_limit INTEGER NOT NULL,
  percent_used REAL DEFAULT 0.0,
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed default resource limits (Cloudflare Free Tier)
INSERT OR IGNORE INTO cms_limit_usage (id, resource_name, used_today, daily_limit, percent_used) VALUES
('1', 'd1_reads', 1250, 5000000, 0.025),
('2', 'd1_writes', 42, 100000, 0.042),
('3', 'kv_reads', 540, 100000, 0.54),
('4', 'kv_writes', 8, 1000, 0.8),
('5', 'worker_requests', 2140, 100000, 2.14);
