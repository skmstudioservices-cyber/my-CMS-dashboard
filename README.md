# Nexus CMS — skeleton

Clean slate for the SKM network control room. The build pipeline, Worker deploy, D1/KV
bindings and the Tailwind + daisyUI design system are wired — everything else is yours to build.

## Architecture

```
GitHub: skmstudioservices-cyber/my-CMS-dashboard
   │  (built + deployed by the bridge workflow in digipincode-india/.github/workflows/cms-deploy.yml)
   ▼
Cloudflare Worker: my-cms-dashboard  →  https://my-cms-dashboard.india-in.workers.dev
   │  Astro SSR (@astrojs/cloudflare) — output: server
   ├── src/pages/          → pages (index.astro = the dashboard)
   ├── src/pages/api/      → JSON endpoints (add your own)
   ├── src/styles/global.css → Tailwind v4 + daisyUI + themes (skmlight default, skmside dark sidebar)
   ├── public/             → static (manifest, sw.js, icon.svg, robots.txt)
   ├── wrangler.jsonc      → Worker name + 7 D1 + 4 KV + AI bindings + 3 crons
   └── schema.sql          → 14 cms_* tables on cms-db
```

- **Stack:** Astro 5 · Tailwind v4 · daisyUI 5 · Cloudflare Workers (D1 + KV + Workers AI).
- **Deploy:** push to `my-CMS-dashboard`, then dispatch `Nexus CMS Deploy (bridge)` in `digipincode-india`.
- **Secrets (Worker):** `NEXUS_TOKEN` (login — currently off), `READ_TOKEN`, `GITHUB_TOKEN`, `CF_API_TOKEN`.
- **Private:** `noindex` + `robots.txt Disallow: /`.

## Files

| Path | Role |
|---|---|
| `astro.config.mjs` | Astro + Cloudflare adapter + Tailwind Vite plugin |
| `package.json` | deps + `build` (blockmap → astro build) |
| `wrangler.jsonc` | Worker config + bindings (source of truth) |
| `schema.sql` | D1 schema (cms_sites, cms_comments, cms_settings, …) |
| `scripts/blockmap.mjs` | scans `src` for `data-block="…"` → `public/blockmap.json` (file + line range) |
| `src/pages/index.astro` | the dashboard page (placeholder — build here) |
| `src/pages/api/` | JSON endpoints |
| `src/styles/global.css` | design system (themes + fonts) |
| `public/` | PWA shell + robots |

## Build & deploy

```bash
npm install
npm run build          # blockmap + astro build → dist/
npx wrangler deploy    # needs CLOUDFLARE_API_TOKEN + ACCOUNT_ID
```
Or dispatch the **Nexus CMS Deploy (bridge)** workflow in `digipincode-india` (uses that repo's CF secrets).

## Conventions

- daisyUI first — custom CSS only where daisyUI can't do it.
- Every element labelled `data-block="section.block.element"`; `data-level` 1-3.
- One 💬 per block; **one** 📋 copy-all; **one** 🎨 colour panel.
- Verify in a real browser (Playwright), never by status code alone.

See **PRD.md** for the full specification.
