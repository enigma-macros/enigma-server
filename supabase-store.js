'use strict';
/*
 * Keeps the whole Enigma database as ONE row in a Supabase table, so the data
 * survives when a free host (Render) restarts and wipes its local files.
 * No packages needed: it uses Node's built-in fetch (Node 18+).
 *
 * Table (run once in Supabase -> SQL Editor):
 *   create table kv (key text primary key, value jsonb not null, updated_at timestamptz default now());
 *   alter table kv enable row level security;
 */
module.exports = function createRemoteStore(opts) {
  const table = opts.table || 'kv';
  const rowKey = opts.rowKey || 'db';
  const log = opts.log || console;
  const base = String(opts.url).replace(/\/+$/, '') + '/rest/v1/' + table;
  const headers = { apikey: opts.key, 'Content-Type': 'application/json' };
  // Old-style (JWT) keys also go in Authorization; the new sb_secret_ keys must not.
  if (String(opts.key).startsWith('eyJ')) headers.Authorization = 'Bearer ' + opts.key;

  let ready = false; // we never write before a successful first load, so an empty DB can never overwrite real data
  let dirty = false;
  let inflight = null;
  let timer = null;
  let getData = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function req(url, init, tries) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(15000) }, init));
        if (res.ok) return res;
        const text = await res.text().catch(() => '');
        const err = new Error('Supabase answered ' + res.status + ': ' + text.slice(0, 300));
        if (res.status < 500 && res.status !== 429) { err.fatal = true; throw err; } // wrong key / missing table: retrying will not help
        lastErr = err;
      } catch (e) {
        if (e.fatal) throw e;
        lastErr = e;
      }
      await sleep(500 * (i + 1));
    }
    throw lastErr;
  }

  // Returns the saved database object, or null when nothing has been saved yet. Throws if Supabase cannot be reached.
  async function load() {
    const res = await req(base + '?key=eq.' + encodeURIComponent(rowKey) + '&select=value', { headers }, 4);
    const rows = await res.json();
    ready = true;
    return Array.isArray(rows) && rows.length ? rows[0].value : null;
  }

  async function run() {
    timer = null;
    if (!dirty || inflight) return;
    dirty = false;
    const body = JSON.stringify({ key: rowKey, value: getData(), updated_at: new Date().toISOString() });
    const h = Object.assign({}, headers, { Prefer: 'resolution=merge-duplicates,return=minimal' });
    inflight = req(base, { method: 'POST', headers: h, body }, 5)
      .then(() => true)
      .catch((e) => { dirty = true; log.error('Could not save to Supabase (will retry): ' + e.message); return false; })
      .then((ok) => {
        inflight = null;
        if (dirty && !timer) timer = setTimeout(run, ok ? 50 : 3000);
      });
  }

  // Call after every change. Many calls in a row become one upload.
  function schedule(fn) {
    getData = fn;
    if (!ready) return;
    dirty = true;
    if (!timer && !inflight) timer = setTimeout(run, 50);
  }

  // Used on shutdown: push whatever is still waiting (gives up after maxMs).
  async function flush(maxMs) {
    const end = Date.now() + (maxMs || 8000);
    if (timer) { clearTimeout(timer); timer = null; }
    while ((dirty || inflight) && Date.now() < end) {
      if (inflight) await inflight; else await run();
    }
  }

  return { load, schedule, flush };
};
