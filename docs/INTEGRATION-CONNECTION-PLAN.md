# Integration connection plan

## Important separation
ChatGPT MCP connections are available to this assistant during supported conversations. They are not automatically credentials or network access for the deployed MyCMS website. The deployed site must authenticate independently with each provider using a provider-supported OAuth flow, server-side API secret, webhook, or a deliberately configured export source.

## Security requirements
- Never place provider API tokens, OAuth refresh tokens, service-account JSON, or Cloudflare secrets in client-side code, public files, or Git history.
- Store secrets in Cloudflare Pages environment variables/secrets and only read them inside server-side Pages Functions.
- Use least-privilege scopes; separate read-only analytics scopes from write/publish permissions.
- Never mark a provider connected based only on the presence of a secret. Run a real authenticated test request and record the provider, scope, result, timestamp, and sanitized error.
- Do not use a "refresh" button to reread a stale snapshot and call it a live refresh.
- Webhooks should verify provider signatures, reject replayed events where supported, and be idempotent.
- Add audit records and confirmation gates before publish, delete, DNS, database, or other high-impact actions.

## Provider setup inventory
- GitHub: GitHub App or fine-grained token; repository permissions scoped to intended projects.
- Cloudflare: scoped API token and account identifier, server-side only.
- Notion: integration token or OAuth; explicitly share the target pages/databases.
- Google Sheets: OAuth or service account; enable Sheets API and authorize only selected spreadsheets.
- Google Search Console: enable API and authorize the verified properties.
- GA4: enable Analytics Data API and authorize the intended properties.
- Bing Webmaster Tools: API key and site authorization.
- Ahrefs: official API access if available in the account, otherwise authorized exports.
- Monetag: official account-supported API/export; otherwise approved email reports.
- Gmail: OAuth read-only scope and a narrow label/sender allowlist for report ingestion.
- Supabase: project URL plus least-privilege key; never expose service-role credentials.
- Additional sample-UI integrations should be added as provider adapters, not hardcoded data panels.

## Google Sheets currently visible in the user's browser
The Sheets home showed:
- SKM Analytics Backup 2026
- SKM Impressions Compounding Plan — Oct 2026
- SKM_Network_Workbook_Redesign_v2
- SKM Studio - Site Inventory & Reference (CF Future Build)
- SKM Network — GSC + GA4 Report (Oct 2026)

Do not ingest every workbook automatically. First choose the canonical source for each dataset, map columns, validate dates/time zones, and prevent duplicate imports. Some of these may be backups or manually compiled reports, not live API sources.

## Access and passkeys
A browser passkey is a login credential, not an IP/device lock. A passkey is normally scoped to a relying-party domain and an account; another person's unrelated account/passkey should not grant access unless that identity is allowed. Synced passkeys can be available on multiple devices belonging to the same account, which is usually intended.

Preferred order:
1. If Cloudflare Access can be enabled without a payment-method blocker, restrict the hostname to the owner's exact identity using Google identity or another supported identity provider; that identity can itself use a passkey to sign in.
2. If Access cannot be enabled, implement application-level authentication with a reviewed WebAuthn/passkey library, server-side credential storage, short-lived signed sessions in Secure/HttpOnly/SameSite cookies, CSRF protections, rate limits, recovery flow, and an initial-admin bootstrap process.
3. Until one of these is deployed and tested, keep privileged write actions disabled and do not treat noindex or a hidden URL as security.
