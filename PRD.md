# PRD — Nexus CMS (SKM Mission Control)

Version 1.0 · 9 Oct 2026 · Owner: SKM Studio Network · Status: build-from-scratch

---

## 1. Purpose

One private control room for the whole SKM network: see every site, database, cron and
automation at a glance, and leave **precise comments on any element** that can be copied as a
single prompt and handed to an agent to fix.

## 2. Users & access

- Single user (the owner). Not public, not multi-tenant.
- **No login for now** (`NEXUS_TOKEN` off); the login gate exists but is disabled.
- **noindex** everywhere (`<meta robots noindex,nofollow>` + `robots.txt Disallow: /`).

## 3. Goals

| # | Goal | Success metric |
|---|---|---|
| G1 | See real state of every site + DB | every view loads live data, 0 errors |
| G2 | Comment on any element | 💬 on every block; comment stores path + line range |
| G3 | Hand fixes to an agent in one shot | one copy → one prompt with all comments |
| G4 | Restyle freely | one colour panel recolours the whole app |

## 4. Non-goals

- No public access, no multi-user accounts, no billing.
- No 2027 planning (locked to Oct-Dec 2026).
- No write access to other sites' repos from here (read-only view).

## 5. Information architecture

```
Drawer
├── Navbar      breadcrumb · search · theme picker · block-level picker · 🎨 · 📋 copy-all · font · sync · avatar
├── Sidebar     Core: Overview, Sites & Stacks
│               Data: D1 Databases, KV Namespaces
│               Operations: Crons, GitHub Runs, Domain Checker
│               Content & AI: Comments, Vault
│               Management: Config
└── Main        page title/sub + view
Overlays        Comment modal · Colours modal · Toast
```

## 6. Functional requirements

### F1 — Shell
Drawer layout (`lg:drawer-open`), dark sidebar (`data-theme="skmside"`), light content
(`skmlight`), sticky topbar, responsive (hamburger < lg).

### F2 — Views (each loads real data)

| View | Content | Source |
|---|---|---|
| Overview | 4 stats, Limit Guard (progress bars), Recommendations | `/api/overview`, `/api/recommendations` |
| Sites & Stacks | table: site, type, stack, status | `/api/sites` |
| D1 Databases | DB select, table list, SQL runner | `/api/d1_tables`, `/api/d1_query` |
| KV Namespaces | namespace select, key list | `/api/kv_list` |
| Crons | job table | `/api/crons` |
| GitHub Runs | recent workflow runs | `/api/github_runs` |
| Domain Checker | RDAP lookup | `/api/domain_check` |
| Comments | all comments | `/api/comments` |
| Config | cms_settings key/values | `/api/config` |
| Vault | static notes page | `/vault` |

### F3 — Element labelling
A client walker labels every meaningful element `data-block="section.block.element"` and sets
`data-level` (1 = outermost) from its labelled-ancestor count. Build step writes
`public/blockmap.json` = block → {file, start, end}.

### F4 — Commenting
- **One 💬 per block** (corner, always visible). Interactive elements get an inline chip *after* them (never inside — that blocks clicks).
- Comment modal shows block path + source line range; supports 🎤 voice (Web Speech, en-IN).
- Stored in `cms_comments` (`site_id` = block path, `comment` = text).

### F5 — Copy-all (single)
**One** 📋 button gathers every comment into one prompt:
`Fix these elements:` + per comment `Block / File+lines / Note`.

### F6 — Colour panel (single)
**One** 🎨 panel with pickers for `primary, secondary, accent, neutral, base-100, base-200,
base-300, base-content`. Applies live via `--color-*` on `:root`; seeded by probing real
components; saved to localStorage **and** `cms_settings.theme_colors`. Plus user swatches.

### F7 — Theme picker
≥10 daisyUI themes (`skmlight` default, `skmside`, business, corporate, luxury, nord, dim,
abyss, silk, night, dark). Persisted.

### F8 — Block-outline level
Selector `Off / L1 outer / L2 inner / L3 fine`, default **L1**. Filters which outlines + labels show.

### F9 — PWA + noindex
`manifest.webmanifest`, `sw.js` (offline shell, never caches `/api/`), `icon.svg`,
`theme-color`; `noindex` meta + `robots.txt`.

## 7. Data model (`schema.sql`, D1 `cms-db`)

`cms_sites` · `cms_templates` · `cms_content` · `cms_comments` · `cms_recommendations` ·
`cms_analytics_hourly` · `cms_log_patterns` · `cms_deployments` · `cms_todos` · `cms_calendar` ·
`cms_accounts` · `cms_settings` · `cms_mcp_access` · `cms_limit_usage`

## 8. API

| Endpoint | Method | Returns |
|---|---|---|
| `/api/overview` | GET | counts + limit usage |
| `/api/sites` | GET | site list + bindings |
| `/api/recommendations` | GET | pending recommendations |
| `/api/crons` | GET | cron jobs |
| `/api/config` | GET/POST | cms_settings |
| `/api/comments` | GET/POST | list / add comment |
| `/api/d1_tables` | GET | table names for a DB |
| `/api/d1_query` | POST | run read SQL |
| `/api/kv_list` | GET | keys in a namespace |
| `/api/github_runs` | GET | recent workflow runs |
| `/api/domain_check` | GET | RDAP lookup |
| `/api/sync_resources` | GET | refresh known sites |

## 9. Design system

- daisyUI + Tailwind v4. Custom CSS only for block outlines / comment chips.
- **Look:** off-white page `#f7f8fa`, white cards, dark sidebar `#0f172a`, vibrant blue
  `#2563eb`, Inter font, soft radii (8-12px), 1px borders, subtle shadows.
- Themes defined in `src/styles/global.css` (`skmlight`, `skmside`).

## 10. Non-functional

- Free tier only; D1-read aware (cache, no full scans); noindex.
- Verified in a real browser (Playwright, Gate 4.0a) — `ERRORS=[]`.
- Secrets in Actions secrets / Worker secrets, never in the repo.

## 11. Deploy

Repo `my-CMS-dashboard` → bridge workflow `digipincode-india/.github/workflows/cms-deploy.yml`
(`npm install` → blockmap → `astro build` → `wrangler d1 execute schema` → `wrangler deploy`).

## 12. Acceptance criteria

1. All F1-F9 pass a Playwright run with `ERRORS=[]`.
2. Every view shows live data (or a clear, honest error state).
3. One copy button produces one complete prompt.
4. One colour panel recolours the whole app live.
5. Block level L1 shows only outermost outlines.

## 13. Roadmap (post-skeleton)

P1 block/comment engine + copy-all · P2 real data views · P3 colour panel + themes ·
P4 GitHub runs + domain checker · P5 login · P6 vault + planner.
