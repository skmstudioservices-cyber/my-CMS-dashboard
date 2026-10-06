# Nexus CMS — Unified Mega Dashboard & Fleet Manager

A single-worker, zero-dependency command center for managing all your Cloudflare Pages, Workers, D1 Databases, KV Namespaces, and GitHub Repositories from a single interface.

Built specifically for high-efficiency operation within the Cloudflare Free Tier constraints.

---

## 🌟 Key Features

- **Nested Mega Dashboard**: Unified sidebar (Cloudflare, GitHub, Content & Design, Data & Storage, Automation & AI, Planner, Settings).
- **Auto-Detection**: Auto-detects connected Cloudflare Pages projects, Workers, D1 databases, and KV namespaces with stack detection (`Astro`, `D1`, `KV`, `Supabase`, `Tailwind`).
- **Free-Tier Limit Guard**: Real-time tracking of D1 Row Reads/Writes, KV Operations, and Worker Requests with automatic warning indicators.
- **D1 Database Explorer**: Execute SQL queries directly against all 7 bound D1 databases from the dashboard.
- **KV Namespace Browser**: Browse and inspect keys across all bound KV namespaces.
- **Comment Collector**: Extract and aggregate `TODO` and `FIXME` comments across your repositories for single-click AI code fixes.
- **AI Agent MCP Server**: Ready-to-use `/mcp/*` endpoints allowing external AI tools to inspect infrastructure state, schemas, and pending recommendations read-only.
- **Cron Automation**:
  - `0 */3 * * *`: Health & uptime verification + quota counter updates.
  - `0 */6 * * *`: Auto-detect new Pages/Workers + run SEO/Security recommendation rules.
  - `0 2 * * *`: Daily log pattern analysis and 45-day anomaly baseline detection.
- **Demo Mode**: Instant inspection via `/demo` or `?demo=1` without requiring initial login credentials.

---

## 🗄️ Bound Resources

### D1 Databases
1. **CMS_DB** (`cms-db`): `7d148ab5-37f1-4721-ba90-bea6472390c2`
2. **SEO_DB** (`seo-keywords-db`): `b3d0300d-7362-489e-91e9-d2dfece64b63`
3. **MAPS_DB** (`mapsnearme-db`): `03a74322-da9e-485d-af1c-e73249d19039`
4. **PINCODE_DB** (`pincode-india-db`): `74274a3f-9fca-42ec-9fbf-c707ffbc56a4`
5. **EXAM_DB** (`examstatus-db`): `5929f80d-1368-417a-9023-3154807b44f1`
6. **EXAM_APAC** (`examstatus-db-apac`): `ecd46bbf-6c1b-4147-8ca7-4ea5336fc1d2`
7. **SKMTOOLS_DB** (`skmtools-db`): `7aef892a-7324-4ccf-ba7f-c1adbe0c9b24`

### KV Namespaces
1. **NEXUS_CACHE** (`nexus-cache`): `e0d8b85873724d2a9779f84b91676e41`
2. **SESSION** (`worker-SESSION`): `cdfd21fd5b28429c9276432ed3d15355`
3. **MAPS_ADS** (`MAPSNEARME_ADS_KV`): `5d3d1232c58e489c8aa016664ca22820`
4. **MAPS_ADS2** (`MAPSNEARME_ADS`): `27b1859eb4f542f58bc33459a7d01520`

---

## 🚀 Deployment & Setup

### 1. Database Schema
Execute the schema file to initialize the 14 management tables in `cms-db`:
```bash
npx wrangler d1 execute cms-db --file=schema.sql --remote
```

### 2. Set Worker Secrets
Store your secrets securely in Cloudflare's vault (never committed to GitHub):
```bash
npx wrangler secret put NEXUS_TOKEN     # Master dashboard access password
npx wrangler secret put READ_TOKEN      # Read-only token for external AI MCP tools
npx wrangler secret put GITHUB_TOKEN    # GitHub PAT for file editing and commits
npx wrangler secret put CF_API_TOKEN    # Cloudflare API Token for resource discovery
```

### 3. Deploy Worker
```bash
npx wrangler deploy
```

### 4. Deploy Static Demo Page (my-cms-dashboard.pages.dev)
```bash
npx wrangler pages deploy public --project-name=my-cms-dashboard --branch=main
```

---

## 🔒 Security Architecture
- The GitHub repository stays **100% public** so you and any AI coding assistants can freely collaborate.
- All tokens, keys, and credentials are kept strictly inside Cloudflare Worker Secrets via `wrangler secret put`.
- External AI tools read live data through authenticated `/mcp/*` endpoints without accessing the production write tokens.
