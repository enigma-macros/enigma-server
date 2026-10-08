'use strict';
/*
  Enigma Macros server (no npm packages needed, Node 18+ only).
  - Discord login (OAuth2, identify scope only)
  - Plans: 7 days / 30 days / lifetime, paid by UPI (owner approves the UTR)
  - License check for the AHK client (/api/verify): key + HWID + expiry from the SERVER clock
  - Owner admin panel at /admin
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ------------------------------------------------------------------ .env */
(function loadEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
})();

const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const PROD = process.env.NODE_ENV === 'production';
const DEV_MODE = process.env.DEV_MODE === '1' && !PROD;
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const UPI_ID = (process.env.UPI_ID || '').trim();
const UPI_NAME = (process.env.UPI_NAME || 'Enigma Macros').trim();
const DISCORD_INVITE = process.env.DISCORD_INVITE || 'https://discord.gg/BYKYZyQMKp';
const STORE_FILE = process.env.DB_PATH || path.join(__dirname, 'data', 'enigma.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const CLIENT_FILE = path.join(__dirname, 'private', 'Enigma.ahk');
const ADMIN_PAGE = path.join(__dirname, 'views', 'admin.html');
const HWID_RESET_COOLDOWN = 7 * 86400; // user may reset the PC binding once every 7 days
const MAX_OPEN_ORDERS = 3;

if (SESSION_SECRET.length < 24) {
  console.error('\nSESSION_SECRET is missing or too short. Put a long random text (30+ characters) in your .env file.\n');
  process.exit(1);
}

const PLANS = {
  d7: { id: 'd7', name: '7 Days', days: 7, price: 100 },
  d30: { id: 'd30', name: '30 Days', days: 30, price: 300 },
  life: { id: 'life', name: 'Lifetime', days: null, price: 1500 },
};
// Free trial (not a purchasable plan). TRIAL_HOURS=0 turns it off.
const TRIAL_HOURS = process.env.TRIAL_HOURS === undefined || process.env.TRIAL_HOURS === '' ? 24 : Number(process.env.TRIAL_HOURS) || 0;
// Discord accounts younger than this many days cannot start a free trial (blocks throw-away accounts). 0 turns the check off.
const TRIAL_MIN_ACCOUNT_DAYS = process.env.TRIAL_MIN_ACCOUNT_DAYS === undefined || process.env.TRIAL_MIN_ACCOUNT_DAYS === '' ? 14 : Number(process.env.TRIAL_MIN_ACCOUNT_DAYS) || 0;
const planInfo = (id) => PLANS[id] || (id === 'trial' ? { id: 'trial', name: 'Free Trial', days: null } : null);

/* -------------------------------------------------------------- database */
// One JSON file, written atomically with a .bak copy. Fine for a few thousand customers.
let DB = { seq: { user: 0, order: 0 }, users: [], licenses: [], orders: [] };
(function loadDb() {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  if (!fs.existsSync(STORE_FILE)) return;
  try {
    DB = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch (e) {
    const bak = STORE_FILE + '.bak';
    console.error('Database file is damaged: ' + e.message);
    if (!fs.existsSync(bak)) process.exit(1);
    DB = JSON.parse(fs.readFileSync(bak, 'utf8'));
    console.error('Loaded the backup copy instead.');
  }
})();
DB.trial_hwids = DB.trial_hwids || []; // PCs (hashed) that already used a free trial
// Optional: keep the data in Supabase (set SUPABASE_URL and SUPABASE_KEY). Needed on free hosts like Render whose files are wiped on restart.
const REMOTE = process.env.SUPABASE_URL && process.env.SUPABASE_KEY
  ? require('./supabase-store')({ url: process.env.SUPABASE_URL.trim(), key: process.env.SUPABASE_KEY.trim() })
  : null;
function saveDb() {
  if (REMOTE) { REMOTE.schedule(() => DB); return; }
  const tmp = STORE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(DB));
  if (fs.existsSync(STORE_FILE)) fs.copyFileSync(STORE_FILE, STORE_FILE + '.bak');
  fs.renameSync(tmp, STORE_FILE);
}
const now = () => Math.floor(Date.now() / 1000);
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const userById = (id) => DB.users.find((u) => u.id === id) || null;
const userByDiscord = (d) => DB.users.find((u) => u.discord_id === d) || null;
const licOf = (uid) => DB.licenses.find((l) => l.user_id === uid) || null;
const isAdmin = (u) => !!u && ADMIN_IDS.includes(u.discord_id);

function upsertUser(discordId, username, avatar) {
  let u = userByDiscord(discordId);
  if (!u) {
    u = { id: ++DB.seq.user, discord_id: discordId, username: username || null, avatar: avatar || null, created_at: now() };
    DB.users.push(u);
  } else {
    if (username) u.username = username;
    if (avatar !== undefined) u.avatar = avatar;
  }
  return u;
}

const KEY_RE = /^ENG-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
function genKey() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike characters
  for (;;) {
    const g = () => Array.from(crypto.randomBytes(4), (b) => A[b % A.length]).join('');
    const k = `ENG-${g()}-${g()}-${g()}`;
    if (!DB.licenses.some((l) => l.key === k)) return k;
  }
}

function licState(l) {
  if (!l) return 'none';
  if (l.revoked) return 'revoked';
  if (l.expires_at === null) return 'active';
  return l.expires_at > now() ? 'active' : 'expired';
}

// Free trial: a normal license (own key) that lasts TRIAL_HOURS from the moment it is started.
function grantTrial(userId) {
  const t = now();
  const l = { user_id: userId, key: genKey(), plan: 'trial', expires_at: t + TRIAL_HOURS * 3600, hwid_hash: null, hwid_reset_at: 0, revoked: 0, created_at: t };
  DB.licenses.push(l);
  return l;
}
// A Discord ID contains the time the account was created.
function discordAccountAgeDays(discordId) {
  try { return (Date.now() - Number((BigInt(discordId) >> 22n) + 1420070400000n)) / 86400000; } catch (e) { return 0; }
}

// Adds a plan to a user. Timed plans stack: new days are added after the current expiry.
function grantPlan(userId, planId) {
  const plan = PLANS[planId];
  const t = now();
  let l = licOf(userId);
  if (!l) {
    l = { user_id: userId, key: genKey(), plan: planId, expires_at: null, hwid_hash: null, hwid_reset_at: 0, revoked: 0, created_at: t };
    l.expires_at = plan.days === null ? null : t + plan.days * 86400;
    DB.licenses.push(l);
    return l;
  }
  const wasActive = !l.revoked && licState(l) === 'active';
  if (plan.days === null) {
    l.expires_at = null;
  } else if (wasActive && l.expires_at === null) {
    // already lifetime: nothing to add
  } else {
    const base = wasActive ? l.expires_at : t;
    l.expires_at = base + plan.days * 86400;
  }
  l.plan = l.expires_at === null ? 'life' : planId;
  l.revoked = 0;
  return l;
}

/* ------------------------------------------------------------- helpers */
function sign(v) { return crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('base64url'); }
function parseCookies(h) {
  const o = {};
  String(h || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) { try { o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) { /* ignore */ } }
  });
  return o;
}
function addCookie(res, name, value, maxAgeSec) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (PROD) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [].concat(prev, parts.join('; ')));
}
function setSession(res, uid) {
  const p = Buffer.from(JSON.stringify({ u: uid, e: now() + 30 * 86400 })).toString('base64url');
  addCookie(res, 'bs', p + '.' + sign(p), 30 * 86400);
}
function currentUser(req) {
  const c = parseCookies(req.headers.cookie).bs;
  if (!c) return null;
  const [p, s] = c.split('.');
  if (!p || !s) return null;
  const a = Buffer.from(s), b = Buffer.from(sign(p));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let d;
  try { d = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch (e) { return null; }
  if (!d || typeof d.e !== 'number' || d.e < now()) return null;
  return userById(d.u);
}
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}
function redirect(res, to) { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); }
const fail = (res, status, error, extra) => sendJson(res, status, Object.assign({ ok: false, error }, extra || {}));

function limiter(max, windowMs) {
  const m = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of m) if (v.reset < t) m.delete(k); }, 60000).unref();
  return (req, res, next) => {
    const k = req.ip || 'x';
    const t = Date.now();
    let e = m.get(k);
    if (!e || e.reset < t) { e = { c: 0, reset: t + windowMs }; m.set(k, e); }
    if (++e.c > max) return fail(res, 429, 'Too many requests. Please wait a bit and try again.', { reason: 'rate' });
    next();
  };
}

// Browsers cannot send this custom header cross-site without permission, so it blocks CSRF.
function csrf(req, res, next) {
  if (req.headers['x-requested-with'] !== 'enigma') return fail(res, 403, 'Bad request.');
  next();
}
function needUser(req, res, next) { if (!req.user) return fail(res, 401, 'Please log in with Discord first.'); next(); }
function needAdmin(req, res, next) { if (!isAdmin(req.user)) return fail(res, 403, 'Admins only.'); next(); }

/* ---------------------------------------------------------------- router */
const routes = [];
function route(method, pattern, ...handlers) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handlers });
}
function readStream(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > 20000) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { const j = JSON.parse(raw); resolve(j && typeof j === 'object' ? j : {}); } catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
function runChain(handlers, req, res) {
  let i = 0;
  const next = () => {
    const h = handlers[i++];
    if (!h) return;
    try {
      const r = h(req, res, next);
      if (r && typeof r.catch === 'function') r.catch((e) => crash(res, e));
    } catch (e) { crash(res, e); }
  };
  next();
}
function crash(res, e) {
  console.error('Error:', e && e.stack ? e.stack : e);
  if (!res.headersSent) fail(res, 500, 'Something went wrong on the server.');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2' };
function serveStatic(req, res) {
  let rel = decodeURIComponent(req.path);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendText(res, 403, 'Forbidden');
  const type = MIME[path.extname(file).toLowerCase()];
  if (!type || !fs.existsSync(file) || !fs.statSync(file).isFile()) return sendText(res, 404, 'Not found');
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600' });
  fs.createReadStream(file).pipe(res);
}

/* ---------------------------------------------------------------- views */
function licView(l) {
  if (!l) return { status: 'none' };
  const plan = planInfo(l.plan);
  return {
    status: licState(l),
    trial: l.plan === 'trial',
    plan: l.plan,
    planName: plan ? plan.name : l.plan,
    lifetime: l.expires_at === null,
    expires_at: l.expires_at,
    key: l.key,
    hwid_bound: !!l.hwid_hash,
    hwid_reset_at: l.hwid_reset_at ? l.hwid_reset_at + HWID_RESET_COOLDOWN : 0,
  };
}
function orderView(o) {
  return { id: o.id, plan: o.plan, planName: (PLANS[o.plan] || {}).name || o.plan, amount: o.amount, status: o.status, utr: o.utr || null, created_at: o.created_at, decided_at: o.decided_at || null };
}
function upiLink(o) {
  const enc = (s) => encodeURIComponent(s).replace(/%40/g, '@');
  return `upi://pay?pa=${enc(UPI_ID)}&pn=${enc(UPI_NAME)}&am=${o.amount}.00&cu=INR&tn=${enc('ENIGMA-' + o.id)}`;
}

/* ------------------------------------------------------- Discord login */
route('GET', '/auth/discord', (req, res) => {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) return sendText(res, 500, 'Discord login is not set up yet. Fill DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in .env');
  const state = crypto.randomBytes(16).toString('hex');
  addCookie(res, 'bst', state, 600);
  const q = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, redirect_uri: BASE_URL + '/auth/callback', response_type: 'code', scope: 'identify', state, prompt: 'none' });
  redirect(res, 'https://discord.com/oauth2/authorize?' + q);
});

route('GET', '/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const saved = parseCookies(req.headers.cookie).bst;
  if (error || !code || !state || !saved || saved !== state) return redirect(res, '/?login=failed');
  try {
    const tr = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: String(code), redirect_uri: BASE_URL + '/auth/callback' }),
    });
    if (!tr.ok) throw new Error('token ' + tr.status);
    const tok = await tr.json();
    const ur = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: 'Bearer ' + tok.access_token } });
    if (!ur.ok) throw new Error('user ' + ur.status);
    const du = await ur.json();
    if (!du || !/^\d{5,25}$/.test(String(du.id))) throw new Error('bad user');
    const u = upsertUser(String(du.id), String(du.global_name || du.username || 'user').slice(0, 64), du.avatar || null);
    saveDb();
    setSession(res, u.id);
    addCookie(res, 'bst', '', 0);
    redirect(res, '/#dashboard');
  } catch (e) {
    console.error('Discord login failed:', e.message);
    redirect(res, '/?login=failed');
  }
});

route('POST', '/auth/logout', csrf, (req, res) => { addCookie(res, 'bs', '', 0); sendJson(res, 200, { ok: true }); });

// Local testing only (DEV_MODE=1 and NODE_ENV not production): /auth/dev?id=123456789012345&name=Tester
route('GET', '/auth/dev', (req, res) => {
  if (!DEV_MODE) return sendText(res, 404, 'Not found');
  const id = String(req.query.id || '');
  if (!/^\d{5,25}$/.test(id)) return sendText(res, 400, 'id must be digits');
  const u = upsertUser(id, String(req.query.name || 'Tester').slice(0, 64), null);
  saveDb();
  setSession(res, u.id);
  redirect(res, '/#dashboard');
});

/* ------------------------------------------------------------ public API */
route('GET', '/api/config', (req, res) => {
  sendJson(res, 200, { plans: Object.values(PLANS), trial: TRIAL_HOURS ? { hours: TRIAL_HOURS } : null, upiReady: !!UPI_ID, discord: DISCORD_INVITE });
});

route('GET', '/api/me', (req, res) => {
  const u = req.user;
  if (!u) return sendJson(res, 200, { user: null });
  const orders = DB.orders.filter((o) => o.user_id === u.id).sort((a, b) => b.id - a.id).slice(0, 10).map(orderView);
  sendJson(res, 200, {
    user: { id: u.discord_id, username: u.username, avatar: u.avatar, isAdmin: isAdmin(u) },
    license: licView(licOf(u.id)),
    orders,
  });
});

/* ---------------------------------------------------------------- orders */
route('POST', '/api/orders', csrf, needUser, limiter(30, 600000), async (req, res) => {
  const body = req.body || {};
  const plan = PLANS[String(body.plan)];
  if (!plan) return fail(res, 400, 'Unknown plan.');
  if (!UPI_ID) return fail(res, 503, 'Payments are not set up yet. Please contact the owner.');
  const l = licOf(req.user.id);
  if (l && licState(l) === 'active' && l.expires_at === null) return fail(res, 400, 'You already have a lifetime license.');
  const mine = DB.orders.filter((o) => o.user_id === req.user.id);
  let o = mine.find((x) => x.status === 'created' && x.plan === plan.id);
  if (!o) {
    if (mine.filter((x) => x.status === 'created' || x.status === 'pending').length >= MAX_OPEN_ORDERS) {
      return fail(res, 400, 'You have too many unpaid orders. Finish or wait for approval of the open ones first.');
    }
    o = { id: ++DB.seq.order, user_id: req.user.id, plan: plan.id, amount: plan.price, utr: null, status: 'created', created_at: now(), utr_at: 0, decided_at: 0, note: '' };
    DB.orders.push(o);
    saveDb();
  }
  sendJson(res, 200, { ok: true, order: Object.assign(orderView(o), { upi_name: UPI_NAME, upi_link: upiLink(o), note: 'ENIGMA-' + o.id }) });
});

route('POST', '/api/orders/:id/utr', csrf, needUser, limiter(15, 600000), async (req, res) => {
  const body = req.body || {};
  const utr = String(body.utr || '').replace(/\s+/g, '');
  if (!/^\d{12}$/.test(utr)) return fail(res, 400, 'The UTR / reference number must be exactly 12 digits.');
  const o = DB.orders.find((x) => x.id === Number(req.params.id) && x.user_id === req.user.id);
  if (!o) return fail(res, 404, 'Order not found.');
  if (o.status !== 'created') return fail(res, 400, 'This order already has a payment submitted.');
  if (DB.orders.some((x) => x.utr === utr)) return fail(res, 409, 'This UTR was already used on another order.');
  o.utr = utr;
  o.utr_at = now();
  o.status = 'pending';
  saveDb();
  sendJson(res, 200, { ok: true, order: orderView(o) });
});

/* -------------------------------------------------------- license / HWID */
route('POST', '/api/trial', csrf, needUser, limiter(10, 600000), (req, res) => {
  if (!TRIAL_HOURS) return fail(res, 400, 'The free trial is not available right now.');
  if (licOf(req.user.id)) return fail(res, 400, 'The free trial is only for accounts that never had a license.');
  if (TRIAL_MIN_ACCOUNT_DAYS && discordAccountAgeDays(req.user.discord_id) < TRIAL_MIN_ACCOUNT_DAYS) {
    return fail(res, 403, 'Your Discord account is too new for the free trial. You can still buy a plan.');
  }
  const l = grantTrial(req.user.id);
  saveDb();
  sendJson(res, 200, { ok: true, license: licView(l) });
});

route('GET', '/api/download', needUser, (req, res) => {
  const l = licOf(req.user.id);
  if (licState(l) !== 'active') return fail(res, 403, 'You need an active license to download the client.');
  if (!fs.existsSync(CLIENT_FILE)) return fail(res, 404, 'The client file is not uploaded on the server yet.');
  // Replace only the FIRST marker (the LicenseURL line). The client also contains the marker text inside its own safety check, which must stay untouched.
  const text = fs.readFileSync(CLIENT_FILE, 'utf8').replace('__LICENSE_BASE__', () => BASE_URL);
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="Enigma.ahk"', 'Cache-Control': 'no-store' });
  res.end(text);
});

route('POST', '/api/hwid/reset', csrf, needUser, (req, res) => {
  const l = licOf(req.user.id);
  if (!l) return fail(res, 404, 'You have no license.');
  if (l.plan === 'trial') return fail(res, 400, 'The free trial stays locked to the PC you first ran it on.');
  if (!l.hwid_hash) return fail(res, 400, 'Your key is not bound to any PC yet.');
  const next = (l.hwid_reset_at || 0) + HWID_RESET_COOLDOWN;
  if (l.hwid_reset_at && next > now()) return fail(res, 429, 'You can reset your PC binding once every 7 days.', { retry_at: next });
  l.hwid_hash = null;
  l.hwid_reset_at = now();
  saveDb();
  sendJson(res, 200, { ok: true });
});

// Called by the AHK client. Answers are flat JSON so AutoHotkey can read them with simple patterns.
route('POST', '/api/verify', limiter(60, 60000), async (req, res) => {
  const body = req.body || {};
  const key = String(body.key || '').trim().toUpperCase();
  const hwid = String(body.hwid || '').trim();
  const bad = (reason) => sendJson(res, 200, { ok: false, reason });
  if (!KEY_RE.test(key) || hwid.length < 8 || hwid.length > 200) return bad('invalid');
  const l = DB.licenses.find((x) => x.key === key);
  if (!l) return bad('invalid');
  const st = licState(l);
  if (st === 'revoked') return bad('revoked');
  if (st === 'expired') return bad('expired');
  const h = sha256(hwid);
  if (!l.hwid_hash) {
    if (l.plan === 'trial') {
      if (DB.trial_hwids.includes(h)) return bad('trial_used'); // this PC already had a free trial
      DB.trial_hwids.push(h);
    }
    l.hwid_hash = h;
    saveDb();
  } else if (l.hwid_hash !== h) return bad('hwid');
  const plan = planInfo(l.plan);
  sendJson(res, 200, { ok: true, plan: plan ? plan.name : 'Plan', lifetime: l.expires_at === null, expires_at: l.expires_at || 0, server_time: now() });
});

/* ------------------------------------------------------------------ admin */
route('GET', '/admin', (req, res) => {
  if (!isAdmin(req.user)) return sendText(res, 403, 'Forbidden. Log in with the admin Discord account first (open the main site, click Login with Discord, then come back here).');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(ADMIN_PAGE));
});

route('GET', '/api/admin/overview', needUser, needAdmin, (req, res) => {
  const withUser = (o) => { const u = userById(o.user_id) || {}; return Object.assign(orderView(o), { discord_id: u.discord_id, username: u.username }); };
  const pending = DB.orders.filter((o) => o.status === 'pending').sort((a, b) => a.utr_at - b.utr_at).map(withUser);
  const recent = DB.orders.filter((o) => o.status === 'approved' || o.status === 'rejected').sort((a, b) => b.decided_at - a.decided_at).slice(0, 30).map(withUser);
  const licenses = DB.licenses.map((l) => {
    const u = userById(l.user_id) || {};
    return { discord_id: u.discord_id, username: u.username, status: licState(l), planName: (planInfo(l.plan) || {}).name || l.plan, expires_at: l.expires_at, key: l.key, hwid_bound: !!l.hwid_hash };
  }).sort((a, b) => String(a.username).localeCompare(String(b.username)));
  sendJson(res, 200, { pending, recent, licenses, upi: UPI_ID });
});

route('POST', '/api/admin/orders/:id/approve', csrf, needUser, needAdmin, (req, res) => {
  const o = DB.orders.find((x) => x.id === Number(req.params.id));
  if (!o || o.status !== 'pending') return fail(res, 404, 'No pending order with this id.');
  o.status = 'approved';
  o.decided_at = now();
  grantPlan(o.user_id, o.plan);
  saveDb();
  sendJson(res, 200, { ok: true });
});

route('POST', '/api/admin/orders/:id/reject', csrf, needUser, needAdmin, async (req, res) => {
  const body = req.body || {};
  const o = DB.orders.find((x) => x.id === Number(req.params.id));
  if (!o || o.status !== 'pending') return fail(res, 404, 'No pending order with this id.');
  o.status = 'rejected';
  o.decided_at = now();
  o.note = String(body.note || '').slice(0, 200);
  saveDb();
  sendJson(res, 200, { ok: true });
});

route('POST', '/api/admin/grant', csrf, needUser, needAdmin, async (req, res) => {
  const body = req.body || {};
  const did = String(body.discord_id || '').trim();
  const plan = PLANS[String(body.plan)];
  if (!/^\d{15,25}$/.test(did)) return fail(res, 400, 'Enter a valid Discord user ID (digits only).');
  if (!plan) return fail(res, 400, 'Unknown plan.');
  const u = upsertUser(did, null, undefined);
  DB.orders.push({ id: ++DB.seq.order, user_id: u.id, plan: plan.id, amount: 0, utr: null, status: 'approved', created_at: now(), utr_at: 0, decided_at: now(), note: 'manual grant' });
  const l = grantPlan(u.id, plan.id);
  saveDb();
  sendJson(res, 200, { ok: true, key: l.key });
});

route('POST', '/api/admin/revoke', csrf, needUser, needAdmin, async (req, res) => {
  const body = req.body || {};
  const u = userByDiscord(String(body.discord_id || '').trim());
  const l = u && licOf(u.id);
  if (!l) return fail(res, 404, 'No license for this user.');
  l.revoked = body.undo ? 0 : 1;
  saveDb();
  sendJson(res, 200, { ok: true });
});

route('POST', '/api/admin/hwid-reset', csrf, needUser, needAdmin, async (req, res) => {
  const body = req.body || {};
  const u = userByDiscord(String(body.discord_id || '').trim());
  const l = u && licOf(u.id);
  if (!l) return fail(res, 404, 'No license for this user.');
  l.hwid_hash = null;
  saveDb();
  sendJson(res, 200, { ok: true });
});

/* ---------------------------------------------------------------- server */
const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  let u;
  try { u = new URL(req.url, 'http://local'); } catch (e) { return sendText(res, 400, 'Bad request'); }
  req.path = u.pathname;
  req.query = Object.fromEntries(u.searchParams);
  req.params = {};
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  req.ip = PROD && fwd ? fwd : req.socket.remoteAddress;
  req.user = currentUser(req);

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(req.path);
    if (!m) continue;
    r.keys.forEach((k, i) => { req.params[k] = decodeURIComponent(m[i + 1]); });
    // Parse the JSON body once so every handler can use req.body
    return runChain([async (rq, rs, next) => {
      if (rq.method === 'POST') {
        try { rq.body = await readStream(rq); } catch (e) { return fail(rs, 400, 'Bad request body.'); }
      }
      next();
    }].concat(r.handlers), req, res);
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
  sendText(res, 404, 'Not found');
});

async function boot() {
  if (REMOTE) {
    try {
      const saved = await REMOTE.load();
      if (saved) { DB = saved; DB.trial_hwids = DB.trial_hwids || []; console.log('Loaded the database from Supabase.'); }
      else { console.log('Supabase is empty, starting fresh' + (DB.users.length ? ' (copying the local data file into it).' : '.')); saveDb(); }
    } catch (e) {
      console.error('\nCannot reach Supabase, so the server will not start (this protects your data).\n' + e.message + '\nCheck SUPABASE_URL, SUPABASE_KEY and that the table "kv" exists.\n');
      process.exit(1);
    }
    const bye = () => REMOTE.flush(8000).finally(() => process.exit(0));
    process.on('SIGTERM', bye);
    process.on('SIGINT', bye);
  }
  server.listen(PORT, () => {
    console.log(`Enigma server running on ${BASE_URL} (port ${PORT})`);
    if (!UPI_ID) console.log('Note: UPI_ID is empty, so customers cannot create orders yet.');
    if (!DISCORD_CLIENT_ID) console.log('Note: Discord keys are empty, so login will not work yet.');
    if (!ADMIN_IDS.length) console.log('Note: ADMIN_IDS is empty, so nobody can open /admin yet.');
    if (DEV_MODE) console.log('DEV_MODE is ON: /auth/dev is open. Never use this on the live server.');
  });
}
boot();
