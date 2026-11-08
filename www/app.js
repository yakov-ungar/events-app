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

  var wide = window.matchMedia('(min-width: 761px)');
  wide.addEventListener && wide.addEventListener('change', function () { chrome(); renderMain(); });
  var view = 'dash', query = '', fPeriod = 'upcoming', fStatus = 'all', fAgent = '', sortK = 'greg_date', sortDir = '', page = 1, PER = 25, selDay = '', month = firstOfMonth(new Date()), sheet = null;


  /* ---------- updates: the GitHub build publishes each APK as a release; the app checks it and offers the newest one ---------- */
  var ver = window.APP_VERSION || {}, upd = null;
  function updBanner() {
    var b = $('#updbar'); if (!b) return;
    if (!upd || String(upd.code) === ls('upd_dismissed')) { b.hidden = true; return; }
    b.hidden = false; b.innerHTML = '<button class="updgo" data-upd><b>' + esc(t('updAvail')) + ' (' + upd.code + ')</b><span>' + esc(t('updTap')) + '</span></button><button class="updx" data-updx aria-label="' + esc(t('updLater')) + '">×</button>';
  }
  function checkUpdate(force) {
    if (!ver.repo || !ver.code) return Promise.resolve('off');
    if (!force && Date.now() - (+ls('upd_checked') || 0) < 3 * 3600 * 1000) return Promise.resolve('skip');
    return fetch('https://api.github.com/repos/' + ver.repo + '/releases/latest', { headers: { Accept: 'application/vnd.github+json' } }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
      ls('upd_checked', String(Date.now()));
      var n = parseInt(String(j.tag_name || '').replace(/\D/g, ''), 10), a = (j.assets || []).filter(function (x) { return /\.apk$/i.test(x.name); })[0];
      upd = n > ver.code && a ? { code: n, url: a.browser_download_url } : null; updBanner(); return upd ? 'new' : 'current';
    }).catch(function () { return 'error'; });
  }
  function startUpdate() { if (!upd) return; try { window.open(upd.url, '_system'); } catch (e) { location.href = upd.url; } }

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
  var timer = null; function paint() { if (timer) return; timer = setTimeout(function () { timer = null; if (gate()) { chip(); renderMain(); } }, 30); }
  function doSync() { return engine.sync().then(function () { if (gate()) { chrome(); renderMain(); } }); }

  /* ---------- main screen ---------- */
  function heb(d, o) { try { return d.toLocaleDateString('he-u-ca-hebrew-nu-latn', o); } catch (e) { return ''; } }
  function hebFull(d) { return lang === 'he' ? heb(d, { day: 'numeric', month: 'long', year: 'numeric' }) : ''; }
  function hebCorner(d) {
    if (lang !== 'he') return '';
    try { var day = '', mon = ''; new Intl.DateTimeFormat('he-u-ca-hebrew-nu-latn', { day: 'numeric', month: 'long' }).formatToParts(d).forEach(function (x) { if (x.type === 'day') day = x.value; if (x.type === 'month') mon = x.value; }); return day === '1' ? day + ' ' + mon : day; } catch (e) { return ''; }
  }
  function badge(e) { var st = e.status || 'scheduled'; return '<span class="badge st-' + esc(st) + '">' + esc(t(st)) + '</span>'; }

  var ICONS = {
    dash: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    events: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'
  };
  var ALLCOLS = ['greg_date', 'heb_date', 'event_type', 'event_name', 'customer_name', 'phone', 'email', 'location', 'singer', 'agent', 'start_time', 'end_time', 'duration', 'price', 'status'];
  var DEFCOLS = ['greg_date', 'heb_date', 'event_type', 'event_name', 'singer', 'agent', 'price', 'status'];
  function isAgent() { return engine.role() === 'agent'; }
  function colsAvail() { return ALLCOLS.filter(function (c) { return !(isAgent() && c === 'price'); }); }
  function getCols() { var m = []; try { m = JSON.parse(ls('events_cols') || '[]'); } catch (e) { } var a = colsAvail(); m = m.filter(function (c) { return a.indexOf(c) >= 0; }); return m.length ? m : DEFCOLS.filter(function (c) { return a.indexOf(c) >= 0; }); }
  function chrome() {
    document.documentElement.lang = lang; document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    $('#title').textContent = t(view === 'events' ? 'evs' : 'dash'); $('#q').placeholder = t('search');
    $('#fab .fl').textContent = t('newEvent'); $('#fab').setAttribute('aria-label', t('newEvent')); $('#fab').hidden = isAgent();
    $('#sidenav').innerHTML = ['dash', 'events', 'settings'].map(function (v) {
      return '<button class="nav' + (v === view ? ' on' : '') + '" ' + (v === 'settings' ? 'data-side="settings"' : 'data-v="' + v + '"') + '><span class="ic"><svg class="svgi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[v] + '</svg></span><span class="lb">' + esc(t(v === 'events' ? 'evs' : v)) + '</span></button>';
    }).join('');
    $('#toolbar').hidden = view !== 'events';
    $('#fPeriod').innerHTML = [['upcoming', 'scopeUp'], ['history', 'scopeHist'], ['all', 'scopeAll']].map(function (o) { return '<option value="' + o[0] + '"' + (fPeriod === o[0] ? ' selected' : '') + '>' + esc(t(o[1])) + '</option>'; }).join('');
    $('#fStatus').innerHTML = '<option value="all">' + esc(t('sAll')) + '</option>' + ['scheduled', 'completed', 'cancelled'].map(function (o) { return '<option value="' + o + '"' + (fStatus === o ? ' selected' : '') + '>' + esc(t(o)) + '</option>'; }).join('');
    var ag = {}; engine.list().forEach(function (e) { if (e.agent) ag[e.agent] = 1; });
    $('#fAgent').hidden = isAgent(); $('#fAgent').innerHTML = '<option value="">' + esc(t('agentAll')) + '</option>' + Object.keys(ag).sort().map(function (n) { return '<option value="' + esc(n) + '"' + (fAgent === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
    var cs = getCols(); $('#kPop').innerHTML = '<div class="ph">' + esc(t('columns')) + '</div>' + colsAvail().map(function (c) { return '<label class="chk"><input type="checkbox" data-col="' + c + '"' + (cs.indexOf(c) >= 0 ? ' checked' : '') + '> ' + esc(t('c_' + c)) + '</label>'; }).join('');
    chip();
  }
  function matches(e) {
    if (query) { var q = query.toLowerCase(); if (![e.event_name, e.customer_name, e.singer, e.location, e.event_type, e.phone, e.email, e.agent, e.notes].some(function (v) { return v && String(v).toLowerCase().indexOf(q) >= 0; })) return false; }
    var st = e.status || 'scheduled', up = e.event_date >= today() && st === 'scheduled';
    if (fPeriod === 'upcoming' && !up) return false;
    if (fPeriod === 'history' && up) return false;
    if (fStatus !== 'all' && st !== fStatus) return false;
    if (fAgent && !isAgent() && e.agent !== fAgent) return false;
    return true;
  }
  function byDate(dir) { return function (a, b) { return dir * (a.event_date.localeCompare(b.event_date) || (a.start_time || '').localeCompare(b.start_time || '')); }; }

  function ecard(e) {
    var dt = parse(e.event_date), meta = [e.event_type, e.location, e.singer].filter(Boolean).join(' · '), hd = hebFull(dt), pr = isAgent() ? '' : money(e.price);
    return '<button class="ecard es-' + esc(e.status || 'scheduled') + '" data-open="' + esc(e.uuid) + '"><span class="ed"><b>' + dt.getDate() + '</b><span>' + esc(fmt(dt, { month: 'short' })) + '</span></span><span class="eb">' +
      '<span class="en"><span class="nm">' + esc(title(e)) + '</span>' + badge(e) + '</span><span class="es">' + timeHtml(e) + (hd ? ' · ' + esc(hd) : '') + '</span>' +
      (meta ? '<span class="et">' + esc(meta) + '</span>' : '') + (e.customer_name ? '<span class="et">' + esc(e.customer_name) + '</span>' : '') + (pr ? '<span class="ep"><span class="price">' + esc(pr) + '</span></span>' : '') + '</span></button>';
  }
  function dmy(s) { var p = String(s).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function mins(e) { if (!e.start_time || !e.end_time) return null; var a = e.start_time.split(':'), b = e.end_time.split(':'), m = (+b[0] * 60 + +b[1]) - (+a[0] * 60 + +a[1]); return m <= 0 ? m + 1440 : m; }
  function cell(k, e) {
    switch (k) {
      case 'greg_date': return esc(dmy(e.event_date));
      case 'heb_date': return esc(hebFull(parse(e.event_date)));
      case 'event_name': return '<button class="lnk" data-open="' + esc(e.uuid) + '">' + esc(title(e)) + '</button>';
      case 'phone': return '<bdi dir="ltr">' + esc(e.phone) + '</bdi>';
      case 'start_time': case 'end_time': return '<bdi dir="ltr">' + esc(e[k]) + '</bdi>';
      case 'duration': var m = mins(e); return m == null ? '' : '<bdi dir="ltr">' + Math.floor(m / 60) + ':' + pad(m % 60) + '</bdi>';
      case 'price': return esc(money(e.price));
      case 'status': return badge(e);
      default: return esc(e[k] || '');
    }
  }
  function table(list, cols, sortable) {
    return '<div class="tbl"><table class="evt"><thead><tr>' + cols.map(function (c) {
      var lab = esc(t('c_' + c)); if (!sortable) return '<th>' + lab + '</th>';
      return '<th><button class="sortb" data-sort="' + c + '">' + lab + (sortK === c ? (sortDirEff() === 'asc' ? ' ▲' : ' ▼') : '') + '</button></th>';
    }).join('') + '</tr></thead><tbody>' + list.map(function (e) {
      return '<tr class="rowlink es-' + esc(e.status || 'scheduled') + '" data-open="' + esc(e.uuid) + '">' + cols.map(function (c) { return '<td' + (c === 'price' || c === 'greg_date' ? ' class="nw"' : '') + '>' + cell(c, e) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
  }
  function evList(list, emptyKey, cols, sortable) {
    if (!list.length) return '<div class="emptystate">' + esc(query ? t('emptySearch') : t(emptyKey)) + '</div>';
    return wide.matches ? table(list, cols || DASHCOLS, sortable) : '<div class="ecards">' + list.map(ecard).join('') + '</div>';
  }
  var DASHCOLS = ['greg_date', 'heb_date', 'event_name', 'singer', 'agent'];
  function sortDirEff() { return sortDir || (sortK === 'greg_date' && fPeriod === 'upcoming' ? 'asc' : sortK === 'greg_date' ? 'desc' : 'asc'); }
  function sortList(list) {
    var dir = sortDirEff() === 'desc' ? -1 : 1, k = sortK;
    return list.slice().sort(function (a, b) {
      var x, y;
      if (k === 'greg_date' || k === 'heb_date') { x = a.event_date + (a.start_time || ''); y = b.event_date + (b.start_time || ''); }
      else if (k === 'price') { return dir * ((+a.price || 0) - (+b.price || 0)); }
      else if (k === 'duration') { return dir * ((mins(a) || 0) - (mins(b) || 0)); }
      else { x = String(a[k] || ''); y = String(b[k] || ''); }
      var c = x.localeCompare(y, lang); return dir * c || a.event_date.localeCompare(b.event_date);
    });
  }
  function calendar() {
    var all = engine.list().filter(function (e) { return e.status !== 'cancelled'; }), by = {}; all.forEach(function (e) { (by[e.event_date] = by[e.event_date] || []).push(e); });
    var first = month, start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay()), td = today(), h = '', wd = '';
    for (var i = 0; i < 7; i++) wd += '<div class="dh">' + esc(fmt(new Date(2023, 0, 1 + i), { weekday: 'narrow' })) + '</div>';
    for (var c = 0; c < 42; c++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + c), k = ymd(d), ev = by[k] || [];
      if (c >= 35 && d.getMonth() !== first.getMonth()) break;
      if (d.getMonth() !== first.getMonth()) { h += '<div class="d empty"></div>'; continue; }
      h += '<button class="d' + (ev.length ? ' has' : '') + (k === td ? ' today' : '') + (k === selDay ? ' sel' : '') + '" data-day="' + k + '"><span class="hd">' + esc(hebCorner(d)) + '</span><span class="n">' + d.getDate() + '</span>' +
        ev.slice(0, 2).map(function (e) { return '<span class="chip">' + esc(title(e)) + '</span>'; }).join('') + (ev.length > 2 ? '<small>' + esc(t('more', { n: ev.length - 2 })) + '</small>' : '') + '</button>';
    }
    var prev = lang === 'he' ? '›' : '‹', next = lang === 'he' ? '‹' : '›', ttl = fmt(first, { month: 'long', year: 'numeric' }), ht = lang === 'he' ? heb(new Date(first.getFullYear(), first.getMonth(), 15), { month: 'long', year: 'numeric' }) : '';
    var out = '<div class="calhead"><button class="icon-btn" data-m="-1" aria-label="-">' + prev + '</button><b>' + esc(ttl) + (ht ? '<small>' + esc(ht) + '</small>' : '') + '</b><button class="icon-btn" data-m="1" aria-label="+">' + next + '</button></div><div class="cal">' + wd + h + '</div>';
    if (selDay) out += '<div class="dayhead">' + esc(fmt(parse(selDay), { weekday: 'long', day: 'numeric', month: 'long' })) + '</div>' + evList(engine.list().filter(function (e) { return e.event_date === selDay; }).sort(byDate(1)), 'emptyDay');
    return out;
  }
  function dashboard() {
    var all = engine.list(), td = today();
    var up = all.filter(function (e) { return e.event_date >= td && e.status !== 'cancelled'; }).sort(byDate(1)).slice(0, 10);
    var past = all.filter(function (e) { return e.event_date < td; }).sort(byDate(-1)).slice(0, 8);
    var recent = past.length ? '<ul class="list">' + past.map(function (e) { return '<li><span class="when">' + esc(fmt(parse(e.event_date), { day: 'numeric', month: 'numeric', year: 'numeric' })) + '</span><button class="lnk" data-open="' + esc(e.uuid) + '">' + esc(title(e)) + '</button>' + (e.singer ? '<span class="sg">' + esc(e.singer) + '</span>' : '') + '</li>'; }).join('') + '</ul>' : '<div class="emptystate">' + esc(t('emptyPast')) + '</div>';
    return '<div class="wgrid"><section class="card widget w12"><h2>' + esc(t('soon')) + '</h2>' + evList(up, 'emptyUpcoming') + '</section>' +
      '<section class="card widget w5"><h2>' + esc(t('recent')) + '</h2>' + recent + '</section>' +
      '<section class="card widget w7"><h2>' + esc(t('calendar')) + '</h2>' + calendar() + '</section></div>';
  }
  function renderMain() {
    if (view !== 'events') { $('#main').innerHTML = dashboard(); return; }
    var all = sortList(engine.list().filter(matches)), pages = Math.max(1, Math.ceil(all.length / PER)); if (page > pages) page = pages;
    var rows = all.slice((page - 1) * PER, page * PER), h = '';
    if (!rows.length) h = '<div class="card tbl"><div class="emptystate">' + esc(t('noEvents')) + '</div></div>';
    else if (wide.matches) h = '<div class="card tbl evtwrap">' + table(rows, getCols(), true).replace(/^<div class="tbl">/, '<div>') + '</div>';
    else h = '<div class="ecards">' + rows.map(ecard).join('') + '</div>';
    if (pages > 1) { h += '<div class="pager">'; for (var i = 1; i <= pages; i++) h += '<button class="pg' + (i === page ? ' on' : '') + '" data-page="' + i + '">' + i + '</button>'; h += '</div>'; }
    $('#main').innerHTML = h;
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
    add(t('f_location'), e.location); add(t('f_singer'), e.singer); add(t('f_agent'), e.agent); if (!isAgent()) add(t('f_price'), money(e.price));
    add(t('f_status'), t(e.status || 'scheduled')); add(t('f_notes'), e.notes);
    $('#sheet').innerHTML = head(t('app')) + '<div class="sheetbody"><p class="big">' + esc(title(e)) + '</p><dl class="detail">' + rows.join('') + '</dl><div class="btns">' +
      (isAgent() ? '' : '<button class="btn grow brass" data-edit>' + esc(t('edit')) + '</button>') + (e.phone ? '<a class="btn ghost' + (isAgent() ? ' grow' : '') + '" href="tel:' + esc(e.phone.replace(/[^\d+]/g, '')) + '">' + esc(t('call')) + '</a>' : '') +
      (isAgent() ? '' : '<button class="btn danger" data-del>' + esc(t('delete')) + '</button>') + '</div></div>';
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
      '<div class="setgroup"><h3>' + esc(t('account')) + '</h3><p class="hint" dir="auto">' + esc(t('signedInAs', { email: c.email })) + '<br>' + esc(isAgent() ? t('roleAgent') + (engine.agentName() ? ': ' + engine.agentName() : '') : t('roleAdmin')) + '</p>' +
      '<div class="btns"><button class="btn danger grow" type="button" data-signout>' + esc(t('signOut')) + '</button></div></div>' +
      (ver.code ? '<div class="setgroup"><p class="hint">' + esc(t('updVersion', { n: ver.code })) + '</p><div class="btns"><button class="btn ghost grow" data-updcheck>' + esc(t('updCheck')) + '</button></div></div>' : '') +
      (msg ? '<p class="' + (sheet.data.ok ? 'ok' : 'err') + '" role="alert">' + esc(msg) + '</p>' : '') +
      '<div class="setgroup"><p class="hint">' + esc(t('events', { n: n })) + '<br>' + esc(t('pending', { n: s.pending.length })) + '<br>' + esc(t('lastSync')) + ': ' + esc(s.lastSync ? ago(s.lastSync) : t('never')) + '</p>' +
      '<div class="btns"><button class="btn grow" data-syncnow>' + esc(t('syncNow')) + '</button><button class="btn danger" data-reset>' + esc(t('resetLocal')) + '</button></div></div></div>';
  }
  function errText(e) { var k = 'err_' + (e.code || (e.offline ? 'offline' : '')); var m = I18N.en[k] ? t(k) : (e.message || 'Error'); return e.code === 'bad_login' && e.message ? m + ' (' + e.message + ')' : m; }

  /* ---------- login: nothing is shown until someone has signed in ---------- */
  var loginShown = false;
  function renderLogin(msg) {
    var c = engine.state.cfg, builtin = !!(cfg0.url && cfg0.key);
    $('#login').innerHTML = '<div class="loginbox"><img class="lg lg-color" src="logo.png" alt=""><img class="lg lg-light" src="logo-light.png" alt=""><h1>' + esc(t('loginTitle')) + '</h1><p class="hint">' + esc(t('loginHint')) + '</p>' +
      '<form id="loginForm" class="form" novalidate><label class="f">' + esc(t('email')) + '<input name="email" type="email" dir="ltr" value="' + esc(c.email || '') + '" autocomplete="username" autocapitalize="none" autofocus></label>' +
      '<label class="f">' + esc(t('password')) + '<input name="password" type="password" dir="ltr" autocomplete="current-password"></label>' +
      (builtin ? '' : '<details open><summary>' + esc(t('connAdv')) + '</summary><label class="f">' + esc(t('url')) + '<input name="url" type="url" dir="ltr" value="' + esc(c.url || '') + '" placeholder="https://xxxx.supabase.co"></label><label class="f">' + esc(t('key')) + '<input name="key" type="text" dir="ltr" value="' + esc(c.key || '') + '"></label></details>') +
      '<p class="err" id="loginErr" role="alert">' + esc(msg || '') + '</p><button class="btn" type="submit">' + esc(t('signIn')) + '</button></form>' +
      '<div class="seg lang"><button data-lang="he" aria-pressed="' + (lang === 'he') + '">עברית</button><button data-lang="en" aria-pressed="' + (lang === 'en') + '">English</button></div></div>';
  }
  function gate() {
    var need = !engine.configured() || !engine.signedIn();
    $('#login').hidden = !need; $('#shell').hidden = need; $('#fab').hidden = need || isAgent(); if (need) $('#sheet').hidden = true;
    if (need && !loginShown) { loginShown = true; sheet = null; renderLogin(); } else if (!need) loginShown = false;
    return !need;
  }
  function submitLogin(form) {
    var f = {}; Array.prototype.forEach.call(form.elements, function (el) { if (el.name) f[el.name] = el.value; });
    var em = String(f.email || '').trim(), err = $('#loginErr');
    if (!em || !f.password) { err.textContent = t('loginErrNeed'); return; }
    var prev = String(engine.state.cfg.email || '').toLowerCase();
    engine.configure({ url: cfg0.url || f.url || engine.state.cfg.url, key: cfg0.key || f.key || engine.state.cfg.key, email: em });
    if (!engine.configured()) { err.textContent = t('err_not_configured'); return; }
    if (prev && prev !== em.toLowerCase()) engine.reset(); /* a different person: never keep the previous person's events on the phone */
    var btn = form.querySelector('[type=submit]'); btn.disabled = true; err.textContent = '';
    engine.signIn(em, f.password).then(function () { gate(); chrome(); renderMain(); return doSync(); }, function (e) { btn.disabled = false; err.textContent = errText(e); });
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('button, a'); if (!el) { var tr = ev.target.closest('tr[data-open]'); if (tr) openSheet('detail', { uuid: tr.dataset.open }); return; }
    if (el.dataset.side === 'settings') { openSheet('settings'); return; }
    if (el.dataset.upd !== undefined) { startUpdate(); return; }
    if (el.dataset.updx !== undefined) { if (upd) ls('upd_dismissed', String(upd.code)); updBanner(); return; }
    if (el.dataset.updcheck !== undefined) { el.disabled = true; checkUpdate(true).then(function (r) { sheet.data = { msg: r === 'new' ? t('updAvail') : r === 'error' ? t('updFailed') : t('updUpToDate'), ok: r !== 'error' }; if (r === 'new') ls('upd_dismissed', ''); updBanner(); renderSettings(); }); return; }
    if (el.dataset.v) { view = el.dataset.v; chrome(); renderMain(); window.scrollTo(0, 0); }
    else if (el.dataset.open) openSheet('detail', { uuid: el.dataset.open });
    else if (el.dataset.day !== undefined) { selDay = selDay === el.dataset.day ? '' : el.dataset.day; var d = parse(el.dataset.day); if (d.getMonth() !== month.getMonth()) month = firstOfMonth(d); renderMain(); }
    else if (el.dataset.m) { month = new Date(month.getFullYear(), month.getMonth() + (+el.dataset.m), 1); renderMain(); }
    else if (el.dataset.close !== undefined) closeSheet();
    else if (el.dataset.edit !== undefined) { var u = sheet.data.uuid; sheet.type = 'form'; renderForm(); sheet.data = { uuid: u }; }
    else if (el.dataset.del !== undefined) { if (confirm(t('confirmDelete'))) { engine.remove(sheet.data.uuid); closeSheet(); doSync(); } }
    else if (el.dataset.lang) { lang = el.dataset.lang; ls('lang', lang); chrome(); renderMain(); if (sheet) renderSettings(); if (!engine.configured() || !engine.signedIn()) { loginShown = false; gate(); } }
    else if (el.dataset.signout !== undefined) { if (engine.state.pending.length && !confirm(t('signOutWarn'))) return; engine.reset(); engine.signOut(); closeSheet(); gate(); }
    else if (el.dataset.page) { page = +el.dataset.page; renderMain(); window.scrollTo(0, 0); }
    else if (el.dataset.sort) { var k = el.dataset.sort; if (sortK === k) sortDir = sortDirEff() === 'asc' ? 'desc' : 'asc'; else { sortK = k; sortDir = 'asc'; } page = 1; renderMain(); }
    else if (el.id === 'kBtn') { $('#kPop').hidden = !$('#kPop').hidden; }
    else if (el.dataset.syncnow !== undefined) { doSync().then(function () { if (sheet && sheet.type === 'settings') { sheet.data = engine.state.lastError ? { msg: errText({ code: engine.state.lastError }) } : { msg: t('connected'), ok: true }; renderSettings(); } }); }
    else if (el.dataset.reset !== undefined) { if (confirm(t('resetConfirm'))) { engine.reset(); renderSettings(); doSync(); } }
    else if (el.id === 'fab') openSheet('form', { date: view === 'dash' ? selDay : '' });
    else if (el.id === 'gear') openSheet('settings');
    else if (el.id === 'syncBtn') { if (gate()) doSync(); }
  });
  document.addEventListener('submit', function (ev) { ev.preventDefault(); if (ev.target.id === 'loginForm') submitLogin(ev.target); else if (ev.target.classList.contains('form')) submitForm(ev.target); });
  $('#q').addEventListener('input', function (e) { query = e.target.value.trim(); page = 1; renderMain(); });
  $('#fAgent').addEventListener('change', function (e) { fAgent = e.target.value; page = 1; renderMain(); });
  $('#kPop').addEventListener('change', function (e) { var cs = []; Array.prototype.forEach.call($('#kPop').querySelectorAll('[data-col]'), function (b) { if (b.checked) cs.push(b.dataset.col); }); if (!cs.length) { e.target.checked = true; return; } ls('events_cols', JSON.stringify(colsAvail().filter(function (c) { return cs.indexOf(c) >= 0; }))); renderMain(); });
  document.addEventListener('click', function (e) { if (!e.target.closest('.kebab')) $('#kPop').hidden = true; });
  $('#fPeriod').addEventListener('change', function (e) { fPeriod = e.target.value; page = 1; renderMain(); });
  $('#fStatus').addEventListener('change', function (e) { fStatus = e.target.value; page = 1; renderMain(); });
  window.addEventListener('online', doSync);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { chip(); checkUpdate(false); if (engine.signedIn()) doSync(); } });
  setInterval(function () { if (!document.hidden && engine.signedIn()) doSync(); else chip(); }, 60000);

  chrome(); renderMain(); checkUpdate(false);
  if (gate()) doSync();
  window.__app = { engine: engine, setLang: function (l) { lang = l; chrome(); renderMain(); } };
})();
