// BLOCK:API-CF — serves the Cloudflare resource snapshot from KV (no secrets client-side)
export const prerender = false;

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const GET = async ({ locals }: any) => {
  try {
    const env = locals?.runtime?.env;
    const kv = env?.NEXUS_CACHE;
    if (!kv) return json({ connected: false, reason: 'KV binding NEXUS_CACHE is not available to this Worker.' });
    const raw = await kv.get('cf:snapshot');
    if (!raw) return json({ connected: false, reason: 'No snapshot published yet. Run the deploy workflow to populate it.' });
    return json({ connected: true, generatedAt: null, ...JSON.parse(raw) });
  } catch (e) {
    return json({ connected: false, reason: String(e) });
  }
};
