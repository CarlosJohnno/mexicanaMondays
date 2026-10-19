// Tiny in-memory PostgREST stand-in for the handful of query shapes index.html uses.
const crypto = require('crypto');
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

class MockDB {
  constructor() { this.t = { profiles: [], matches: [], players: [], games: [] }; this.log = []; }
  seedProfile(name) { const r = { id: uuid(), name, pin_hash: 'x', created_at: now() }; this.t.profiles.push(r); return r; }
  defaults(table, row) {
    const base = { id: uuid(), created_at: now() };
    if (table === 'matches') Object.assign(base, { status: 'lobby', courts: 1, hidden_at: null, hidden_note: null, format: 'americano', target_rounds: null });
    if (table === 'players') Object.assign(base, { joined_at: now(), seat: null, profile_id: null, added_by: null });
    if (table === 'games') Object.assign(base, { score1: null, score2: null, round: null, court: null });
    return { ...base, ...row };
  }
  unique(table, row) {
    if (table === 'players') return this.t.players.some(p => p.match_id === row.match_id && (p.profile_id === row.profile_id || p.name === row.name));
    if (table === 'games') return this.t.games.some(g => g.match_id === row.match_id && g.round === row.round && g.court === row.court);
    if (table === 'matches') return this.t.matches.some(m => m.code === row.code);
    if (table === 'profiles') return this.t.profiles.some(p => p.name.toLowerCase() === row.name.toLowerCase());
    return false;
  }
  filter(table, params) {
    let rows = this.t[table].slice();
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      const m = v.match(/^(not\.)?(eq|is|in|gte|lte|gt|lt|ilike|neq)\.(.*)$/s);
      if (!m) throw new Error('unsupported filter ' + k + '=' + v);
      const [, not, op, raw] = m;
      const test = r => {
        const x = r[k];
        switch (op) {
          case 'eq': return String(x) === raw;
          case 'neq': return String(x) !== raw;
          case 'is': return raw === 'null' ? x === null || x === undefined : String(x) === raw;
          case 'in': return raw.slice(1, -1).split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(x));
          case 'gte': return x >= raw;
          case 'lte': return x <= raw;
          case 'gt': return x > raw;
          case 'lt': return x < raw;
          case 'ilike': { const re = new RegExp('^' + raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/\\\\(.)/g, '$1') + '$', 'i'); return re.test(String(x)); }
        }
      };
      rows = rows.filter(r => not ? !test(r) : test(r));
    }
    const order = params.get('order');
    if (order) {
      const [col, dir] = order.split('.');
      rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
    }
    const limit = params.get('limit'); if (limit) rows = rows.slice(0, +limit);
    return rows;
  }
  project(rows, select) {
    if (!select || select === '*') return rows;
    const cols = select.split(',');
    return rows.map(r => Object.fromEntries(cols.map(c => [c, r[c]])));
  }
  // returns {status, body, headers}
  handle(method, url, headers, body) {
    const u = new URL(url);
    const path = u.pathname.replace(/^.*\/rest\/v1\//, '');
    const params = u.searchParams;
    const wantObject = (headers['accept'] || '').includes('vnd.pgrst.object');
    const prefer = headers['prefer'] || '';
    this.log.push(method + ' ' + path + '?' + params.toString());
    const json = (status, data, extra = {}) => ({ status, body: JSON.stringify(data), headers: { 'content-type': 'application/json', ...extra } });
    const wrap = rows => wantObject ? (rows.length === 1 ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'no row' })) : json(200, rows);
    if (path.startsWith('rpc/')) {
      const fn = path.slice(4); const args = JSON.parse(body || '{}');
      if (fn === 'cancel_match') {
        const m = this.t.matches.find(x => x.id === args.p_match_id && !x.hidden_at && (!args.p_only_if_status || x.status === args.p_only_if_status));
        if (m) { m.hidden_at = now(); m.hidden_note = args.p_note || 'cancelled'; }
        return json(200, !!m);
      }
      return json(404, { message: 'no rpc ' + fn });
    }
    const table = path;
    if (!this.t[table]) return json(404, { message: 'no table ' + table });
    if (method === 'HEAD' || method === 'GET') {
      const rows = this.filter(table, params);
      // RLS: hidden matches and their children are invisible
      const vis = table === 'matches' ? rows.filter(r => !r.hidden_at) : (table === 'players' || table === 'games') ? rows.filter(r => { const m = this.t.matches.find(x => x.id === r.match_id); return m && !m.hidden_at; }) : rows;
      const out = this.project(vis, params.get('select'));
      if (method === 'HEAD') return { status: 200, body: '', headers: { 'content-range': `0-${out.length}/${out.length}` } };
      const r = wrap(out); if (prefer.includes('count=exact')) r.headers['content-range'] = `0-${out.length}/${out.length}`; return r;
    }
    if (method === 'POST') {
      const data = JSON.parse(body); const list = Array.isArray(data) ? data : [data];
      const made = [];
      for (const row of list) { if (this.unique(table, row)) return json(409, { code: '23505', message: 'duplicate key value violates unique constraint' }); const full = this.defaults(table, row); this.t[table].push(full); made.push(full); }
      return wantObject ? json(201, made[0]) : json(201, made);
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(body); const rows = this.filter(table, params);
      rows.forEach(r => Object.assign(r, patch));
      return wantObject ? json(200, rows[0]) : json(200, prefer.includes('representation') ? rows : []);
    }
    if (method === 'DELETE') {
      const rows = this.filter(table, params); const ids = new Set(rows.map(r => r.id));
      this.t[table] = this.t[table].filter(r => !ids.has(r.id));
      return json(200, []);
    }
    return json(405, { message: 'nope' });
  }
}
module.exports = { MockDB };
