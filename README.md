# SKM Control Room

SKM Studio's private control dashboard for sites, GitHub, Cloudflare resources, data connections, and project status.

## Production architecture

- **Source of truth:** `main` in `skmstudioservices-cyber/my-CMS-dashboard`.
- **Deployment:** GitHub-connected Cloudflare Pages project `my-cms-dashboard`.
- **Build command:** `npm run build`.
- **Build output:** `dist`.
- **Runtime endpoint:** Cloudflare Pages Function `functions/api/cf.ts`, available at `/api/cf`.
- **Cloudflare snapshot:** the function reads the `cf:snapshot` value from the `NEXUS_CACHE` KV binding. API tokens must never be sent to the browser.
- **Node.js:** pinned to 22.22.0 in `.node-version`.

The Astro pages are statically generated. Runtime/API code belongs in the root `functions/` directory so the site remains compatible with Cloudflare Pages and does not depend on the Astro Cloudflare Worker adapter.

## Stack

- Astro 7.4.2
- Tailwind CSS 4.3.3 with the official Vite plugin
- Cloudflare Pages Functions for the small runtime API
- Cloudflare KV and D1 bindings configured in the Pages project

## Local development

```sh
npm install
npm run dev
npm run build
```

## Deployment

Push to `main`. The connected Cloudflare Pages project builds and deploys from GitHub. Do not use the old Worker/Pages Wrangler bridge as the production site deployment path; its Worker build assumptions belong to the previous adapter-based architecture.

## Project files

| Path | Purpose |
|---|---|
| `astro.config.mjs` | Astro static build and Tailwind plugin |
| `src/pages/` | Dashboard pages |
| `src/components/` | Shared UI, navigation, and global feedback panel |
| `functions/api/cf.ts` | Read-only Cloudflare snapshot endpoint |
| `scripts/blockmap.mjs` | Generates the UI block map |
| `schema.sql` | Planned CMS D1 schema |
| `public/` | PWA manifest, service worker, icons, and headers |
