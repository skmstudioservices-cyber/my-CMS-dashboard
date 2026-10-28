// Cloudflare Pages Function: GET /api/cf
// Serves the saved Cloudflare resource snapshot from KV; never exposes API tokens.
interface SnapshotKV {
  get(key: string): Promise<string | null>;
}

interface Env {
  NEXUS_CACHE?: SnapshotKV;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });

export const onRequestGet = async ({ env }: { env: Env }) => {
  try {
    const kv = env?.NEXUS_CACHE;
    if (!kv) {
      return json({
        connected: false,
        reason: 'KV binding NEXUS_CACHE is not available to this Pages environment.',
      }, 503);
    }

    const raw = await kv.get('cf:snapshot');
    if (!raw) {
      return json({
        connected: false,
        reason: 'No Cloudflare snapshot is saved yet. Refresh the snapshot workflow.',
      }, 503);
    }

    const snapshot = JSON.parse(raw);
    return json({
      ...snapshot,
      connected: true,
      generatedAt: snapshot.generatedAt ?? null,
    });
  } catch {
    return json({
      connected: false,
      reason: 'The saved Cloudflare snapshot could not be read.',
    }, 500);
  }
};
