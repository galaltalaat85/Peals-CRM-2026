// Vercel serverless function: stores Pears CRM leads in Upstash Redis.
// Needs these environment variables in Vercel:
//   CRM_PASSWORD                      (you choose it)
//   KV_REST_API_URL / KV_REST_API_TOKEN   (added automatically when you connect Upstash Redis)

const DB_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const DB_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmd) {
  const r = await fetch(DB_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + DB_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

function same(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!DB_URL || !DB_TOKEN) return res.status(500).json({ error: 'Database is not connected yet. Add Upstash Redis in the Storage tab.' });
  if (!process.env.CRM_PASSWORD) return res.status(500).json({ error: 'CRM_PASSWORD is not set in Vercel.' });
  if (!same(req.headers['x-crm-password'], process.env.CRM_PASSWORD)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const flat = await redis(['HGETALL', 'pears:leads']);
      const values = Array.isArray(flat)
        ? flat.filter((_, i) => i % 2 === 1)
        : Object.values(flat || {});
      const leads = values.map(v => { try { return JSON.parse(v); } catch (e) { return null; } }).filter(Boolean);
      const currency = await redis(['GET', 'pears:currency']);
      return res.status(200).json({ leads, settings: { currency: currency || 'USD' } });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      if (body.lead) {
        const l = body.lead;
        if (!l.id || typeof l.id !== 'string' || l.id.length > 64 || !l.name) return res.status(400).json({ error: 'Invalid lead' });
        const text = JSON.stringify(l);
        if (text.length > 100000) return res.status(400).json({ error: 'Lead is too large' });
        await redis(['HSET', 'pears:leads', l.id, text]);
        return res.status(200).json({ ok: true });
      }
      if (body.settings && typeof body.settings.currency === 'string') {
        await redis(['SET', 'pears:currency', body.settings.currency.slice(0, 8)]);
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'Nothing to save' });
    }

    if (req.method === 'DELETE') {
      const id = req.query && req.query.id;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await redis(['HDEL', 'pears:leads', String(id)]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
