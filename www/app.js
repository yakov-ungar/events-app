(function () {
  'use strict';
  var Sync = window.EventSync, I18N = window.I18N;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  var lang = ls('lang') === 'en' ? 'en' : 'he';
  function t(k, vars) { var s = (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k; if (vars) Object.keys(vars).forEach(function (n) { s = s.replace('{' + n + '}', vars[n]); }); return s; }

  var engine = new Sync.Engine({ storage: window.localStorage, key: 'events_state_v1', onChange: function () { paint(); } });
  var cfg0 = window.APP_CONFIG || {};
  if (!engine.configured() && cfg0.url && cfg0.key) engine.configure({ url: cfg0.url, key: cfg0.key, email: cfg0.email || '' });

  var view = 'upcoming', query = '', selDay = '', month = firstOfMonth(new Date()), sheet = null;

  /* ---------- dates ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function today() { return ymd(new Date()); }
  function loc() { return lang === 'he' ? 'he-IL' : 'en-GB'; }
  function fmt(d, o) { try { return d.toLocaleDateString(loc(), o); } catch (e) { return ymd(d); } }
  function money(p) { var n = Number(p); return n > 0 ? '₪' + n.toLocaleString(loc(), { maximumFractionDigits: 2 }) : ''; }
  function timeText(e) { return e.start_time ? (e.end_time ? e.start_time + '–' + e.end_time : e.start_time) : t('noTime'); }
  function timeHtml(e) { return e.start_time ? '<bdi dir="ltr">' + esc(timeText(e)) + '</bdi>' : esc(timeText(e)); }
  function rich(h) { return h.replace(/«/g, '<bdi dir="ltr">').replace(/»/g, '</bdi>'); }
  function title(e) { return e.event_name || e.customer_name || e.event_type || t('untitled'); }
  function minutes(s) { var m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; }

  /* ---------- sync status ---------- */
  function ago(ms) {
    var m = Math.floor((Date.now() - ms) / 60000);
    if (m < 1) return t('justNow'); if (m < 60) return t('minAgo', { n: m });
    var h = Math.floor(m / 60); if (h < 24) return t('hrAgo', { n: h });
    return t('dayAgo', { n: Math.floor(h / 24) });
  }
  function chip() {
    var s = engine.state, el = $('#syncBtn'), cls = 'syncchip', txt;
    if (!engine.configured() || !engine.signedIn()) { cls += ' warn'; txt = t('setupSync'); }
    else if (engine.syncing) { cls += ' busy'; txt = t('syncing'); }
    else if (s.lastError === 'offline') { cls += ' warn'; txt = t('offline') + (s.pending.length ? ' · ' + t('waiting', { n: s.pending.length }) : ''); }
    else if (s.lastError) { cls += ' bad'; txt = t(s.lastError === 'signed_out' ? 'setupSync' : 'syncFailed'); }
    else if (s.pending.length) { cls += ' warn'; txt = t('waiting', { n: s.pending.length }); }
    else txt = s.lastSync ? t('synced') + ' · ' + ago(s.lastSync) : t('synced');
    el.className = cls; el.textContent = txt;
  }
  var timer = null; function paint() { if (timer) return; timer = setTimeout(function () { timer = null; chip(); renderMain(); }, 30); }
  function doSync() { return engine.sync().then(function () { chip(); renderMain(); }); }

  /* ---------- main screen ---------- */
  function chrome() {
    document.documentElement.lang = lang; document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    $('#title').textContent = t('app'); $('#q').placeholder = t('search'); $('#gear').setAttribute('aria-label', t('settings'));
    $('#fab').setAttribute('aria-label', t('newEvent'));
    $('#tabs').innerHTML = ['upcoming', 'past', 'calendar'].map(function (v) { return '<button class="tab" role="tab" data-v="' + v + '" aria-selected="' + (view === v) + '">' + esc(t(v)) + '</button>'; }).join('');
    $('#searchWrap').hidden = view === 'calendar';
    chip();
  }
  function matches(e) {
    if (!query) return true; var q = query.toLowerCase();
    return [e.event_name, e.customer_name, e.singer, e.location, e.event_type, e.phone, e.agent, e.notes].some(function (v) { return v && String(v).toLowerCase().indexOf(q) >= 0; });
  }
  function card(e) {
    var meta = [e.event_type, e.location, e.singer].filter(Boolean).join(' · '), sub = [e.customer_name].filter(Boolean).join(' · ');
    return '<button class="card ' + esc(e.status) + '" data-open="' + esc(e.uuid) + '"><span class="row"><span class="time">' + timeHtml(e) + '</span><span class="price">' + esc(money(e.price)) + '</span></span>' +
      '<span class="name">' + esc(title(e)) + '</span>' + (meta ? '<span class="meta">' + esc(meta) + '</span>' : '') + (sub ? '<span class="meta">' + esc(sub) + '</span>' : '') +
      (e.status === 'completed' || e.status === 'cancelled' ? '<span><span class="chip ' + esc(e.status) + '">' + esc(t(e.status)) + '</span></span>' : '') + '</button>';
  }
  function agenda(list, isPast) {
    if (!list.length) return '<p class="empty">' + esc(query ? t('emptySearch') : t(isPast ? 'emptyPast' : 'emptyUpcoming')) + '</p>';
    var days = {}, order = []; list.forEach(function (e) { if (!days[e.event_date]) { days[e.event_date] = []; order.push(e.event_date); } days[e.event_date].push(e); });
    var td = today();
    return order.map(function (d) {
      var dt = parse(d);
      return '<section class="day ' + (isPast ? 'past' : '') + '"><div class="key ' + (d === td ? 'today' : '') + '"><b>' + dt.getDate() + '</b><span>' + esc(fmt(dt, { weekday: 'short' })) + '</span><span>' + esc(fmt(dt, { month: 'short' })) + '</span></div><div class="cards">' + days[d].map(card).join('') + '</div></section>';
    }).join('');
  }
  function calendar() {
    var all = engine.list(), counts = {}; all.forEach(function (e) { if (e.status !== 'cancelled') counts[e.event_date] = (counts[e.event_date] || 0) + 1; });
    var first = month, start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay()), td = today(), h = '';
    var wd = ''; for (var i = 0; i < 7; i++) wd += '<div class="wd">' + esc(fmt(new Date(2023, 0, 1 + i), { weekday: 'narrow' })) + '</div>';
    for (var c = 0; c < 42; c++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + c), k = ymd(d), n = counts[k] || 0;
      if (c >= 35 && d.getMonth() !== first.getMonth()) break;
      h += '<button class="cell' + (d.getMonth() !== first.getMonth() ? ' out' : '') + (k === td ? ' today' : '') + (k === selDay ? ' sel' : '') + '" data-day="' + k + '"><span>' + d.getDate() + '</span>' + (n ? '<span class="dots">' + '<i></i>'.repeat(Math.min(n, 3)) + '</span>' : '') + '</button>';
    }
    var prev = lang === 'he' ? '›' : '‹', next = lang === 'he' ? '‹' : '›';
    var out = '<div class="cal"><div class="calhead"><button data-m="-1" aria-label="-">' + prev + '</button><b>' + esc(fmt(first, { month: 'long', year: 'numeric' })) + '</b><button data-m="1" aria-label="+">' + next + '</button></div><div class="grid7">' + wd + h + '</div></div>';
    if (selDay) {
      var dayEvents = all.filter(function (e) { return e.event_date === selDay; });
      out += '<div class="dayhead">' + esc(fmt(parse(selDay), { weekday: 'long', day: 'numeric', month: 'long' })) + '</div>' + (dayEvents.length ? '<div class="cards">' + dayEvents.map(card).join('') + '</div>' : '<p class="empty">' + esc(t('emptyDay')) + '</p>');
    }
    return out;
  }
  function renderMain() {
    var td = today(), all = engine.list().filter(matches), html;
    if (view === 'calendar') html = calendar();
    else if (view === 'upcoming') html = agenda(all.filter(function (e) { return e.event_date >= td; }), false);
    else html = agenda(all.filter(function (e) { return e.event_date < td; }).reverse().sort(function (a, b) { return b.event_date.localeCompare(a.event_date) || (a.start_time || '').localeCompare(b.start_time || ''); }), true);
    $('#main').innerHTML = html;
  }

  /* ---------- sheets ---------- */
  function openSheet(type, data) {
    if (!sheet) history.pushState({ sheet: 1 }, '');
    sheet = { type: type, data: data || {} }; var w = $('#sheet'); w.hidden = false; w.scrollTop = 0;
    if (type === 'detail') renderDetail(); else if (type === 'form') renderForm(); else renderSettings();
    var f = w.querySelector('[autofocus]'); if (f) f.focus();
  }
  function closeSheet(fromPop) { if (!sheet) return; sheet = null; $('#sheet').hidden = true; $('#sheet').innerHTML = ''; if (!fromPop && history.state && history.state.sheet) history.back(); renderMain(); chip(); }
  window.addEventListener('popstate', function () { if (sheet) closeSheet(true); });

  function head(titleText) { return '<div class="sheethead"><button class="iconbtn" data-close aria-label="' + esc(t('close')) + '"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="' + (lang === 'he' ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7') + '"/></svg></button><h2>' + esc(titleText) + '</h2></div>'; }

  function renderDetail() {
    var e = engine.get(sheet.data.uuid); if (!e) { closeSheet(); return; }
    var dt = parse(e.event_date), rows = [];
    function add(label, val, html) { if (val) rows.push('<div><dt>' + esc(label) + '</dt><dd>' + (html || esc(val)) + '</dd></div>'); }
    add(t('f_event_date'), e.event_date, esc(fmt(dt, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })));
    add(t('f_start_time'), e.start_time ? timeText(e) : '', e.start_time ? timeHtml(e) : '');
    add(t('f_event_type'), e.event_type); add(t('f_customer_name'), e.customer_name);
    add(t('f_phone'), e.phone, '<a href="tel:' + esc(e.phone.replace(/[^\d+]/g, '')) + '" dir="ltr">' + esc(e.phone) + '</a>');
    add(t('f_email'), e.email, '<a href="mailto:' + esc(e.email) + '" dir="ltr">' + esc(e.email) + '</a>');
    add(t('f_location'), e.location); add(t('f_singer'), e.singer); add(t('f_agent'), e.agent); add(t('f_price'), money(e.price));
    add(t('f_status'), t(e.status || 'scheduled')); add(t('f_notes'), e.notes);
    $('#sheet').innerHTML = head(t('app')) + '<div class="sheetbody"><p class="big">' + esc(title(e)) + '</p><dl class="detail">' + rows.join('') + '</dl><div class="btns">' +
      '<button class="btn grow brass" data-edit>' + esc(t('edit')) + '</button>' + (e.phone ? '<a class="btn ghost" href="tel:' + esc(e.phone.replace(/[^\d+]/g, '')) + '">' + esc(t('call')) + '</a>' : '') +
      '<button class="btn danger" data-del>' + esc(t('delete')) + '</button></div></div>';
  }

  function listOpts(id, field) { return '<datalist id="' + id + '">' + engine.suggestions(field).map(function (v) { return '<option value="' + esc(v) + '">'; }).join('') + '</datalist>'; }
  function renderForm() {
    var e = sheet.data.uuid ? engine.get(sheet.data.uuid) : null, v = e || { event_date: sheet.data.date || today(), status: 'scheduled' };
    function inp(name, type, extra) { return '<label class="f">' + esc(t('f_' + name)) + '<input name="' + name + '" type="' + type + '" value="' + esc(v[name]) + '" ' + (extra || '') + '></label>'; }
    var stat = ['scheduled', 'completed', 'cancelled'].map(function (s) { return '<option value="' + s + '"' + (v.status === s ? ' selected' : '') + '>' + esc(t(s)) + '</option>'; }).join('');
    $('#sheet').innerHTML = head(t(e ? 'editEvent' : 'newEvent')) + '<form class="sheetbody form" novalidate>' +
      inp('event_date', 'date', 'required') + '<div class="pair">' + inp('start_time', 'time') + inp('end_time', 'time') + '</div>' +
      inp('event_name', 'text', 'autocomplete="off"') + inp('event_type', 'text', 'list="dl_type" autocomplete="off"') + inp('customer_name', 'text', 'autocomplete="off"') +
      '<div class="pair">' + inp('phone', 'tel', 'dir="ltr" inputmode="tel" autocomplete="off"') + inp('email', 'email', 'dir="ltr" autocomplete="off"') + '</div>' +
      inp('location', 'text', 'list="dl_loc" autocomplete="off"') + '<div class="pair">' + inp('singer', 'text', 'list="dl_singer" autocomplete="off"') + inp('agent', 'text', 'list="dl_agent" autocomplete="off"') + '</div>' +
      '<div class="pair">' + inp('price', 'number', 'inputmode="decimal" min="0" step="any"') + '<label class="f">' + esc(t('f_status')) + '<select name="status">' + stat + '</select></label></div>' +
      '<label class="f">' + esc(t('f_notes')) + '<textarea name="notes">' + esc(v.notes) + '</textarea></label>' +
      listOpts('dl_type', 'event_type') + listOpts('dl_loc', 'location') + listOpts('dl_singer', 'singer') + listOpts('dl_agent', 'agent') +
      '<p class="err" id="formErr" role="alert" hidden></p><div class="btns"><button class="btn grow brass" type="submit">' + esc(t('save')) + '</button><button class="btn ghost" type="button" data-close>' + esc(t('cancel')) + '</button></div></form>';
  }
  function submitForm(form) {
    var f = {}; Array.prototype.forEach.call(form.elements, function (el) { if (el.name) f[el.name] = el.value; });
    var err = $('#formErr'); function fail(m) { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center' }); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.event_date)) return fail(t('dateRequired'));
    var a = minutes(f.start_time), b = minutes(f.end_time); if (f.end_time && !f.start_time) f.start_time = f.end_time;
    var uuid = sheet.data.uuid || null, old = uuid ? engine.get(uuid) : null;
    var changed = !old || old.event_date !== f.event_date || old.start_time !== f.start_time || old.end_time !== f.end_time;
    if (changed && f.status !== 'cancelled') {
      var clash = engine.list().filter(function (e) { return e.uuid !== uuid && e.event_date === f.event_date && e.status !== 'cancelled'; });
      if (clash.length && !confirm(t('clash') + '\n' + clash.map(function (e) { return '• ' + timeText(e) + ' ' + title(e); }).join('\n') + '\n\n' + t('saveAnyway'))) return;
    }
    var id = engine.save(uuid, f); closeSheet(); doSync(); return id;
  }

  function renderSettings() {
    var c = engine.state.cfg, s = engine.state, n = engine.list().length, msg = sheet.data.msg || '';
    $('#sheet').innerHTML = head(t('settings')) + '<div class="sheetbody">' +
      '<div class="setgroup"><h3>' + esc(t('language')) + '</h3><div class="seg"><button data-lang="he" aria-pressed="' + (lang === 'he') + '">עברית</button><button data-lang="en" aria-pressed="' + (lang === 'en') + '">English</button></div></div>' +
      '<form class="setgroup" id="conn" novalidate><h3>' + esc(t('connection')) + '</h3><p class="hint">' + esc(t('hintSettings')) + '</p>' +
      '<label class="f">' + esc(t('url')) + '<input name="url" type="url" dir="ltr" value="' + esc(c.url) + '" placeholder="https://xxxx.supabase.co" autocomplete="off"></label>' +
      '<label class="f">' + esc(t('key')) + '<input name="key" type="text" dir="ltr" value="' + esc(c.key) + '" autocomplete="off"></label>' +
      '<label class="f">' + esc(t('email')) + '<input name="email" type="email" dir="ltr" value="' + esc(c.email) + '" autocomplete="username"></label>' +
      '<label class="f">' + esc(t('password')) + '<input name="password" type="password" dir="ltr" autocomplete="current-password"></label>' +
      (msg ? '<p class="' + (sheet.data.ok ? 'ok' : 'err') + '" role="alert">' + esc(msg) + '</p>' : '') +
      '<p class="hint">' + esc(engine.signedIn() ? t('signedInAs', { email: c.email }) : t('notSignedIn')) + '</p>' +
      '<div class="btns"><button class="btn grow brass" type="submit">' + esc(t('signIn')) + '</button>' + (engine.signedIn() ? '<button class="btn ghost" type="button" data-signout>' + esc(t('signOut')) + '</button>' : '') + '</div></form>' +
      '<div class="setgroup"><p class="hint">' + esc(t('events', { n: n })) + '<br>' + esc(t('pending', { n: s.pending.length })) + '<br>' + esc(t('lastSync')) + ': ' + esc(s.lastSync ? ago(s.lastSync) : t('never')) + '</p>' +
      '<div class="btns"><button class="btn grow" data-syncnow>' + esc(t('syncNow')) + '</button><button class="btn danger" data-reset>' + esc(t('resetLocal')) + '</button></div></div></div>';
  }
  function errText(e) { var k = 'err_' + (e.code || (e.offline ? 'offline' : '')); return I18N.en[k] ? t(k) : (e.message || 'Error'); }
  function submitConn(form) {
    var f = {}; Array.prototype.forEach.call(form.elements, function (el) { if (el.name) f[el.name] = el.value; });
    engine.configure({ url: f.url, key: f.key, email: f.email });
    if (!engine.configured()) { sheet.data = { msg: t('err_not_configured') }; return renderSettings(); }
    var btn = form.querySelector('[type=submit]'); btn.disabled = true;
    (f.password ? engine.signIn(f.email, f.password) : Promise.resolve()).then(function () { if (!engine.signedIn()) { sheet.data = { msg: t('notSignedIn') }; return renderSettings(); } sheet.data = { msg: t('connected'), ok: true }; renderSettings(); return doSync(); })
      .catch(function (e) { sheet.data = { msg: errText(e) }; renderSettings(); });
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('button, a'); if (!el) return;
    if (el.dataset.v) { view = el.dataset.v; chrome(); renderMain(); }
    else if (el.dataset.open) openSheet('detail', { uuid: el.dataset.open });
    else if (el.dataset.day !== undefined) { selDay = selDay === el.dataset.day ? '' : el.dataset.day; var d = parse(el.dataset.day); if (d.getMonth() !== month.getMonth()) month = firstOfMonth(d); renderMain(); }
    else if (el.dataset.m) { month = new Date(month.getFullYear(), month.getMonth() + (+el.dataset.m), 1); renderMain(); }
    else if (el.dataset.close !== undefined) closeSheet();
    else if (el.dataset.edit !== undefined) { var u = sheet.data.uuid; sheet.type = 'form'; renderForm(); sheet.data = { uuid: u }; }
    else if (el.dataset.del !== undefined) { if (confirm(t('confirmDelete'))) { engine.remove(sheet.data.uuid); closeSheet(); doSync(); } }
    else if (el.dataset.lang) { lang = el.dataset.lang; ls('lang', lang); chrome(); renderMain(); renderSettings(); }
    else if (el.dataset.signout !== undefined) { engine.signOut(); renderSettings(); chip(); }
    else if (el.dataset.syncnow !== undefined) { doSync().then(function () { if (sheet && sheet.type === 'settings') { sheet.data = engine.state.lastError ? { msg: errText({ code: engine.state.lastError }) } : { msg: t('connected'), ok: true }; renderSettings(); } }); }
    else if (el.dataset.reset !== undefined) { if (confirm(t('resetConfirm'))) { engine.reset(); renderSettings(); doSync(); } }
    else if (el.id === 'fab') openSheet('form', { date: view === 'calendar' ? selDay : '' });
    else if (el.id === 'gear') openSheet('settings');
    else if (el.id === 'syncBtn') { if (!engine.configured() || !engine.signedIn() || engine.state.lastError === 'signed_out') openSheet('settings'); else doSync(); }
  });
  document.addEventListener('submit', function (ev) { ev.preventDefault(); if (ev.target.id === 'conn') submitConn(ev.target); else if (ev.target.classList.contains('form')) submitForm(ev.target); });
  $('#q').addEventListener('input', function (e) { query = e.target.value.trim(); renderMain(); });
  window.addEventListener('online', doSync);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { chip(); if (engine.signedIn()) doSync(); } });
  setInterval(function () { if (!document.hidden && engine.signedIn()) doSync(); else chip(); }, 60000);

  chrome(); renderMain();
  if (!engine.configured() || !engine.signedIn()) { if (!engine.state.pending.length && !engine.list().length) setTimeout(function () { openSheet('settings'); }, 250); }
  else doSync();
  window.__app = { engine: engine, setLang: function (l) { lang = l; chrome(); renderMain(); } };
})();
