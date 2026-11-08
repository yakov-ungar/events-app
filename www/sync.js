/* Sync engine: keeps a local copy of the events and syncs it with the website through the Supabase table "changes".
 * Works in the app (window.EventSync) and in Node (for tests). No dependencies.
 * Rules (same as the website): every edit is one row in "changes"; for each event (uuid) the row with the highest ts wins;
 * rows are only ever added, never edited or deleted. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var FIELDS = ['event_date', 'start_time', 'end_time', 'event_name', 'event_type', 'customer_name', 'phone', 'email', 'location', 'singer', 'agent', 'price', 'status', 'notes'];
  var PAGE = 500, PUSH_CHUNK = 100;

  function uuidv4() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); (typeof crypto !== 'undefined' ? crypto : require('crypto').webcrypto).getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /** Applies one row from the server to the local copy. Newest ts wins; field values of equal-or-newer rows are merged over older ones. */
  function mergeRow(events, row) {
    var data = row.data && typeof row.data === 'object' ? row.data : {};
    var ev = events[row.uuid];
    if (!ev) { events[row.uuid] = { ts: row.ts, deleted: !!row.deleted, data: Object.assign({}, data) }; return true; }
    if (row.ts < ev.ts) return false;
    ev.data = Object.assign({}, ev.data, data); ev.ts = row.ts; ev.deleted = !!row.deleted; return true;
  }

  function Engine(opts) {
    opts = opts || {};
    this.storage = opts.storage; this.key = opts.key || 'events_state_v1';
    this.fetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(typeof self !== 'undefined' ? self : globalThis) : null);
    this.now = opts.now || function () { return Date.now(); };
    this.onChange = opts.onChange || function () {};
    this.syncing = false; this.again = false;
    this.state = { cfg: { url: '', key: '', email: '' }, auth: null, cursor: 0, events: {}, pending: [], lastSync: 0, lastError: '', users: [], me: null };
    this.bcrypt = opts.bcrypt || (typeof dcodeIO !== 'undefined' && dcodeIO.bcrypt) || (typeof self !== 'undefined' && self.dcodeIO && self.dcodeIO.bcrypt) || null;
    this._load();
  }
  var P = Engine.prototype;

  P._load = function () {
    try { var raw = this.storage && this.storage.getItem(this.key); if (raw) { var s = JSON.parse(raw); if (s && typeof s === 'object') Object.assign(this.state, s); } } catch (e) { /* start empty */ }
  };
  P._save = function () { try { if (this.storage) this.storage.setItem(this.key, JSON.stringify(this.state)); } catch (e) { /* storage full or blocked: keep working in memory */ } this.onChange(); };

  /** Who is using the app: a website user (checked against the user list that syncs down from the site). No one signed in = least privilege. */
  P.role = function () { return this.state.me ? this.state.me.role : 'agent'; };
  P.agentName = function () { return this.state.me ? this.state.me.agent : ''; };
  P.loggedIn = function () { return !!this.state.me; };
  P._canSee = function (d) { return this.role() !== 'agent' || (!!this.agentName() && d && d.agent === this.agentName()); };
  /** Checks a website username + password against the synced user list (works offline once the list is on the phone). */
  P.login = function (username, password) {
    var self = this, u = String(username || '').trim().toLowerCase(), bc = this.bcrypt;
    var user = (this.state.users || []).filter(function (x) { return x.active && String(x.username).toLowerCase() === u; })[0];
    return new Promise(function (resolve, reject) {
      var bad = function () { var e = new Error('bad_login'); e.code = 'bad_login'; reject(e); };
      if (!user || !bc) return bad();
      bc.compare(String(password), String(user.password_hash).replace(/^\$2[xy]\$/, '$2a$'), function (err, ok) {
        if (err || !ok) return bad();
        self.state.me = { id: user.id, username: user.username, name: user.full_name || user.username, role: user.role === 'admin' ? 'admin' : 'agent', agent: user.agent || '' };
        self._save(); resolve(self.state.me);
      });
    });
  };
  P.logout = function () { this.state.me = null; this._save(); };
  /** Downloads the user list and keeps the signed-in person's role/agent in step with the site (switched off or deleted = signed out). */
  P._pullUsers = async function () {
    var rows = await this._api('GET', '/rest/v1/app_users?select=id,username,full_name,password_hash,role,agent,active&order=id.asc');
    if (!Array.isArray(rows)) throw new Error('bad_response');
    this.state.users = rows;
    var me = this.state.me;
    if (me) { var u = rows.filter(function (x) { return x.id === me.id; })[0]; if (!u || !u.active) this.state.me = null; else this.state.me = { id: u.id, username: u.username, name: u.full_name || u.username, role: u.role === 'admin' ? 'admin' : 'agent', agent: u.agent || '' }; }
    this._save();
  };
  P.configured = function () { var c = this.state.cfg; return !!(c.url && c.key); };
  P.signedIn = function () { return !!(this.state.auth && this.state.auth.refresh); };
  P.configure = function (cfg) { this.state.cfg = { url: String(cfg.url || '').trim().replace(/\/+$/, ''), key: String(cfg.key || '').trim(), email: String(cfg.email || '').trim() }; this._save(); };

  P._http = async function (method, path, body, headers) {
    var c = this.state.cfg; if (!c.url || !c.key) throw new Error('not_configured');
    var h = Object.assign({ apikey: c.key, 'Content-Type': 'application/json' }, headers || {});
    var res;
    try { res = await this.fetch(c.url + path, { method: method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { var err = new Error('offline'); err.offline = true; throw err; }
    var text = ''; try { text = await res.text(); } catch (e) { /* ignore */ }
    var json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }
    return { status: res.status, json: json, text: text };
  };

  P._setAuth = function (j) {
    this.state.auth = { access: j.access_token, refresh: j.refresh_token || (this.state.auth && this.state.auth.refresh), exp: this.now() + (Number(j.expires_in) || 3600) * 1000 };
    this._save();
  };

  /** Signs in with the one account created in Supabase (Authentication > Users). The password is not stored. */
  P.signIn = async function (email, password) {
    var r = await this._http('POST', '/auth/v1/token?grant_type=password', { email: String(email).trim(), password: String(password) });
    if (r.status !== 200 || !r.json || !r.json.access_token) { var e = new Error((r.json && (r.json.error_description || r.json.msg || r.json.message)) || ('HTTP ' + r.status)); e.code = 'bad_login'; throw e; }
    this.state.cfg.email = String(email).trim(); this._setAuth(r.json);
  };
  P.signOut = function () { this.state.auth = null; this._save(); };
  P.reset = function () { var c = this.state.cfg; this.state = { cfg: c, auth: null, cursor: 0, events: {}, pending: [], lastSync: 0, lastError: '', users: [], me: null }; this._save(); };

  P._refresh = async function () {
    if (!this.signedIn()) { var e = new Error('signed_out'); e.code = 'signed_out'; throw e; }
    var r = await this._http('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: this.state.auth.refresh });
    if (r.status !== 200 || !r.json || !r.json.access_token) { this.state.auth = null; this._save(); var e2 = new Error('signed_out'); e2.code = 'signed_out'; throw e2; }
    this._setAuth(r.json);
  };

  /** Authenticated REST call. Refreshes the token when it is about to expire or the server says it expired. */
  P._api = async function (method, path, body, headers) {
    if (!this.signedIn()) { var e = new Error('signed_out'); e.code = 'signed_out'; throw e; }
    if (this.state.auth.exp - this.now() < 60000) await this._refresh();
    for (var attempt = 0; ; attempt++) {
      var r = await this._http(method, path, body, Object.assign({ Authorization: 'Bearer ' + this.state.auth.access }, headers || {}));
      if (r.status === 401 && attempt === 0) { await this._refresh(); continue; }
      if (r.status < 200 || r.status >= 300) { var er = new Error((r.json && (r.json.message || r.json.hint)) || ('HTTP ' + r.status)); er.status = r.status; throw er; }
      return r.json;
    }
  };

  /** One full sync: read new changes, then send our waiting changes. Never throws; the result is in state.lastError. */
  P.sync = async function () {
    if (this.syncing) { this.again = true; return this.result(); }
    this.syncing = true;
    try {
      do {
        this.again = false;
        try { await this._pullUsers(); this.state.usersError = ''; } catch (e) { if (e.code === 'signed_out' || e.offline) throw e; this.state.usersError = e.message || 'users'; }
        await this._pull();
        await this._push();
        if (this.state.pending.length === 0) await this._pull(); // pick up our own rows so the bookmark moves past them
      } while (this.again);
      this.state.lastSync = this.now(); this.state.lastError = '';
    } catch (e) { this.state.lastError = e.code || (e.offline ? 'offline' : (e.message || 'error')); }
    this.syncing = false; this._save(); return this.result();
  };
  P.result = function () { return { ok: !this.state.lastError, error: this.state.lastError, pending: this.state.pending.length }; };

  P._pull = async function () {
    for (var n = 0; n < 60; n++) {
      var rows = await this._api('GET', '/rest/v1/changes?select=id,ts,uuid,source,deleted,data&order=id.asc&limit=' + PAGE + '&id=gt.' + this.state.cursor);
      if (!Array.isArray(rows)) throw new Error('bad_response');
      for (var i = 0; i < rows.length; i++) { var r = rows[i]; if (r && r.uuid) mergeRow(this.state.events, { uuid: r.uuid, ts: Number(r.ts), deleted: r.deleted, data: r.data }); this.state.cursor = Math.max(this.state.cursor, Number(r.id) || 0); }
      this._save();
      if (rows.length < PAGE) break;
    }
  };

  P._push = async function () {
    while (this.state.pending.length) {
      var chunk = this.state.pending.slice(0, PUSH_CHUNK);
      var body = chunk.map(function (c) { return { uuid: c.uuid, ts: c.ts, source: 'app', deleted: !!c.deleted, data: c.data || {} }; });
      await this._api('POST', '/rest/v1/changes', body, { Prefer: 'return=minimal' });
      this.state.pending.splice(0, chunk.length); this._save();
    }
  };

  /** Creates or edits an event on this phone right away (works offline) and queues it for the next sync. Returns the uuid. */
  P.save = function (uuid, fields) {
    var data = {}; FIELDS.forEach(function (f) { data[f] = fields[f] == null ? '' : String(fields[f]).trim(); });
    if (data.price !== '' && !isNaN(Number(data.price))) data.price = Number(data.price).toFixed(2);
    uuid = uuid || uuidv4(); var ev = this.state.events[uuid];
    var ts = Math.max(this.now(), ev ? ev.ts + 1 : 0);
    this.state.events[uuid] = { ts: ts, deleted: false, data: data };
    this.state.pending.push({ uuid: uuid, ts: ts, deleted: false, data: data }); this._save(); return uuid;
  };
  P.remove = function (uuid) {
    var ev = this.state.events[uuid]; if (!ev) return; var ts = Math.max(this.now(), ev.ts + 1);
    ev.ts = ts; ev.deleted = true; this.state.pending.push({ uuid: uuid, ts: ts, deleted: true, data: {} }); this._save();
  };

  /** Live events, oldest date first. */
  P.list = function () {
    var out = []; var ev = this.state.events;
    var self = this; Object.keys(ev).forEach(function (u) { var e = ev[u]; if (!e.deleted && e.data && e.data.event_date && self._canSee(e.data)) out.push(Object.assign({ uuid: u, ts: e.ts }, e.data)); });
    out.sort(function (a, b) { return (a.event_date + (a.start_time || '99:99')).localeCompare(b.event_date + (b.start_time || '99:99')); });
    return out;
  };
  P.get = function (uuid) { var e = this.state.events[uuid]; return e && !e.deleted && this._canSee(e.data) ? Object.assign({ uuid: uuid, ts: e.ts }, e.data) : null; };
  /** Values already used for a field (singers, locations...), for the type-ahead lists. */
  P.suggestions = function (field) {
    var seen = {}, out = []; var ev = this.state.events;
    var self = this; Object.keys(ev).forEach(function (u) { var v = ev[u].data && self._canSee(ev[u].data) && ev[u].data[field]; if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  };

  return { Engine: Engine, mergeRow: mergeRow, FIELDS: FIELDS, uuidv4: uuidv4 };
});
