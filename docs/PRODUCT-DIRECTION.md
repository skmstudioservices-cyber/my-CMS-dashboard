# MyCMS Dashboard — product direction and implementation plan

Updated: 2026-10-28

## Product rules
- The supplied UI is a visual sample only. Demo data in it is not a defect; do not treat its numbers or site list as real.
- Never hardcode live resource inventories, counts, analytics, commit history, deployment status, or connection state. Load them from authenticated APIs, MCP-connected sources, webhooks, or scheduled synchronization.
- If a source is not connected, show a clear "Connect required" state. Never silently substitute sample numbers.
- Main screen is a tabbed workspace. Child views should open as tabs inside the workspace where practical, not force full-page navigation.
- Dashboard is the landing page (not "Overview"). Show global metrics with charts, tables, number cards, trends, and user-selectable visualizations.
- Selecting a website opens its own workspace with its domains, connected repo(s), deployments, analytics, infrastructure, content, tasks, and integration status.
- GitHub repository commit lists expand inline to show commit message, author, date, files/diff summary, checks, and links. Common actions can be performed in CMS only when API permissions and safeguards allow; otherwise provide direct official links.
- Every data panel must show source, last successful sync timestamp, freshness/staleness, and error state. Hover/focus can reveal exact timestamp; timestamps must also be accessible on touch devices.
- Support Refresh all and section-specific refresh. Use caching, incremental sync, rate-limit awareness, backoff, idempotency, and per-provider sync cursors.
- Page Builder should support draft, preview, validation, publish, and deployment tracking. Use GitHub commits/workflows or the site's supported publishing API. Never imply it published when it only generated HTML.
- Comfort settings: Google Fonts and other reputable free font libraries, readable text scale, line height, contrast, reduced motion, theme/color choices, language/locale, and chart/table/card display modes. Respect system preferences and store user choices.
- Prefer official APIs and existing MCP connectors where reliable. Use Sheets only where it is an intentional source of truth, not as a workaround for an available official API.
- Analytics connectors to evaluate: GA4, Google Search Console, Bing Webmaster Tools, Monetag, Ahrefs (API/export/email reports depending on access), and any integrations shown in the sample UI. Email-derived data must be explicitly parsed and labeled by source/date.
- Keep secrets server-side (Cloudflare secrets / environment variables / managed OAuth). Never put tokens in client JavaScript or commit them.
- Because the dashboard can manage sites and infrastructure, protect sensitive data and write actions with authentication, authorization, CSRF protection where applicable, validation, audit logs, and confirmation for destructive actions. noindex is not authentication.

## Proposed workspace
1. Dashboard — network-wide metrics and visualizations.
2. Sites — dynamic site registry; each site opens a site-specific dashboard.
3. GitHub — repositories, expandable commits, workflows/actions, PRs/issues, releases, statuses, safe actions, direct links.
4. Cloudflare — Pages, deployments, Workers, D1, KV, domains, schedules, resource health, safe actions.
5. Analytics & Search — GA4, Search Console, Bing, SEO providers and monetization metrics.
6. Content & Publishing — content planning, page builder, preview/publish/deploy status.
7. Integrations — provider connection state, scopes, data sources, sync history, health, reconnect/disconnect.
8. Tasks & Automation — manual jobs, scheduled sync, webhooks, alerts and audit trail.
9. Settings — font, contrast, layout, visualization, language, refresh policies and accessibility.

## Sync contract
Each provider adapter should expose: connect/status, fetch initial snapshot, incremental sync, refresh, last-success time, next scheduled run (if any), source links, rate-limit/error state, and normalized records. Use a common sync ledger and cache with TTLs. Trigger updates from webhooks when available and scheduled polling otherwise. UI refresh should enqueue/execute the relevant refresh safely and return honest progress; it must not just re-read an old snapshot while claiming to refresh upstream.

## Delivery sequence
P0: secure the dashboard before exposing account data or write actions; correct stale build/runtime assumptions.
P1: workspace shell, nested tabs, global/site dashboard framework, accessible font/display settings.
P2: reliable Cloudflare + GitHub adapters, sync ledger, refresh controls, expandable commit details.
P3: Notion, Search Console, Bing, GA4, Sheets, Supabase, and other sample-UI integrations based on actual available credentials/scopes.
P4: chart/display preferences, alerts, email-derived reports, Monetag/Ahrefs options.
P5: page builder publishing with validation, rollback path, deployment monitoring.
P6: browser verification across desktop/mobile, API error states, sync freshness, and write-action safeguards.

## Verification rules
- Do not claim integration is connected until an authenticated real API request succeeds.
- Do not claim auto-sync until a webhook or scheduled job has been configured and its last successful run is verified.
- Do not claim a production deploy until the live canonical URL is tested after the deployment.
- CI build success alone is not a browser or integration test.
