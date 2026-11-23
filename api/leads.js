// Vercel serverless function: stores Pearls CRM leads and the team in Upstash Redis.
// Needs these environment variables in Vercel:
//   CRM_PASSWORD                          the ADMIN password (you choose it)
//   KV_REST_API_URL / KV_REST_API_TOKEN   (added automatically when you connect Upstash Redis)
// Optional:
//   ADMIN_NAME                            name shown for the admin in activity logs (default "Admin")
//
// Who can do what:
//   Admin (signs in with CRM_PASSWORD): sees every lead, assigns leads, adds/removes team members.
//   Team member (signs in with own email + password): sees and edits only the leads assigned to them.

const crypto = require('crypto');

const DB_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const DB_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const LEADS = 'pears:leads';
const USERS = 'pears:users';

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

const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 120;

function hashPw(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 32).toString('hex');
}

function parseHash(flat) {
  const values = Array.isArray(flat) ? flat.filter((_, i) => i % 2 === 1) : Object.values(flat || {});
  return values.map(v => { try { return JSON.parse(v); } catch (e) { return null; } }).filter(Boolean);
}

async function getUser(email) {
  const raw = await redis(['HGET', USERS, email]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

const publicUser = u => ({ name: u.name, email: u.email, created: u.created || 0 });

// Returns { role, name, email } or null.
async function whoIs(req) {
  const pw = req.headers['x-crm-password'];
  const email = normEmail(req.headers['x-crm-email']);
  if (!pw) return null;
  if (same(pw, process.env.CRM_PASSWORD)) {
    return { role: 'admin', name: process.env.ADMIN_NAME || 'Admin', email: '' };
  }
  if (!email) return null;
  const u = await getUser(email);
  if (!u || !u.salt || !u.hash) return null;
  if (!same(hashPw(pw, u.salt), u.hash)) return null;
  return { role: 'member', name: u.name, email: u.email };
}

function readBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!DB_URL || !DB_TOKEN) return res.status(500).json({ error: 'Database is not connected yet. Add Upstash Redis in the Storage tab.' });
  if (!process.env.CRM_PASSWORD) return res.status(500).json({ error: 'CRM_PASSWORD is not set in Vercel.' });

  try {
    const me = await whoIs(req);
    if (!me) return res.status(401).json({ error: 'Unauthorized' });
    const isAdmin = me.role === 'admin';
    const forbid = () => res.status(403).json({ error: 'Only the admin can do this.' });

    if (req.method === 'GET') {
      let leads = parseHash(await redis(['HGETALL', LEADS]));
      if (!isAdmin) leads = leads.filter(l => normEmail(l.assignedTo) === me.email);
      const team = isAdmin
        ? parseHash(await redis(['HGETALL', USERS])).map(publicUser).sort((a, b) => a.name.localeCompare(b.name))
        : [{ name: me.name, email: me.email }];
      const currency = await redis(['GET', 'pears:currency']);
      return res.status(200).json({ me, leads, team, settings: { currency: currency || 'USD' } });
    }

    if (req.method === 'POST') {
      const body = readBody(req);

      if (body.lead) {
        const l = body.lead;
        if (!l.id || typeof l.id !== 'string' || l.id.length > 64 || !l.name) return res.status(400).json({ error: 'Invalid lead' });
        const oldRaw = await redis(['HGET', LEADS, l.id]);
        let old = null; try { old = oldRaw ? JSON.parse(oldRaw) : null; } catch (e) { old = null; }

        if (isAdmin) {
          const to = normEmail(l.assignedTo);
          if (to) {
            const u = await getUser(to);
            if (!u) return res.status(400).json({ error: 'That team member does not exist.' });
            l.assignedTo = u.email; l.assignedName = u.name;
          } else { l.assignedTo = ''; l.assignedName = ''; }
        } else {
          // A team member may only touch leads that are theirs, and cannot hand them to someone else.
          if (old && normEmail(old.assignedTo) !== me.email) return res.status(403).json({ error: 'This lead is not assigned to you.' });
          l.assignedTo = me.email; l.assignedName = me.name;
          if (old) { l.assignedAt = old.assignedAt; l.assignedBy = old.assignedBy; }
          else { l.assignedAt = Date.now(); l.assignedBy = me.name; }
        }

        const text = JSON.stringify(l);
        if (text.length > 100000) return res.status(400).json({ error: 'Lead is too large' });
        await redis(['HSET', LEADS, l.id, text]);
        return res.status(200).json({ ok: true, lead: l });
      }

      if (body.member) {
        if (!isAdmin) return forbid();
        const m = body.member;
        const email = normEmail(m.email);
        const name = String(m.name || '').trim().slice(0, 80);
        if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
        if (!name) return res.status(400).json({ error: 'Enter the team member\'s name.' });
        const existing = await getUser(email);
        const pw = m.password ? String(m.password) : '';
        if (!existing && pw.length < 6) return res.status(400).json({ error: 'Choose a password of at least 6 characters.' });
        if (pw && pw.length < 6) return res.status(400).json({ error: 'Choose a password of at least 6 characters.' });
        const u = Object.assign({}, existing || { email, created: Date.now() }, { name });
        if (pw) { u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hashPw(pw, u.salt); }
        await redis(['HSET', USERS, email, JSON.stringify(u)]);
        // Keep the name on their leads in step if it changed.
        if (existing && existing.name !== name) {
          const leads = parseHash(await redis(['HGETALL', LEADS])).filter(l => normEmail(l.assignedTo) === email);
          for (const l of leads) { l.assignedName = name; await redis(['HSET', LEADS, l.id, JSON.stringify(l)]); }
        }
        return res.status(200).json({ ok: true, member: publicUser(u) });
      }

      if (body.settings && typeof body.settings.currency === 'string') {
        if (!isAdmin) return forbid();
        await redis(['SET', 'pears:currency', body.settings.currency.slice(0, 8)]);
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'Nothing to save' });
    }

    if (req.method === 'DELETE') {
      if (!isAdmin) return forbid();
      const q = req.query || {};
      if (q.member) {
        const email = normEmail(q.member);
        await redis(['HDEL', USERS, email]);
        // Their leads go back to "Unassigned" so nothing is lost.
        const leads = parseHash(await redis(['HGETALL', LEADS])).filter(l => normEmail(l.assignedTo) === email);
        for (const l of leads) {
          const act = Array.isArray(l.activity) ? l.activity : [];
          act.unshift({ t: Date.now(), text: 'Unassigned (' + (l.assignedName || email) + ' was removed from the team)', by: me.name });
          Object.assign(l, { assignedTo: '', assignedName: '', activity: act, updated: Date.now() });
          await redis(['HSET', LEADS, l.id, JSON.stringify(l)]);
        }
        return res.status(200).json({ ok: true, unassigned: leads.length });
      }
      const id = q.id;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await redis(['HDEL', LEADS, String(id)]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
