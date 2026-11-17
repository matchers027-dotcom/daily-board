// app.js — 1枚の静的ページの通信と画面の差し替え(docs/plan-20261116-web-page-3.md 4章)。
// 本体の ID と鍵はページの URL のフラグメント(# の後ろ)にだけ置く。鍵とデプロイ ID は端末に保存しない。端末に残すのは本体が返した材料の最後の1回分だけ(apStorage_ の4関数。docs/plan-20261116-web-page-4.md)。
// HTML の組み立ては render.js(純関数)。ここは通信・計測・ボタンの配線だけ。

const AP_VERSION_ = 2;
const AP_ACTIONS_ = ['view_page_data', 'view_page_answer', 'view_page_timing'];
const AP_TIMEOUT_MS_ = 25000;
const AP_STORE_KEY_ = 'hlb_page_last';
const AP_STORE_FORMAT_ = 1;
const AP_STORE_MAX_AGE_MS_ = 604800000;
const AP_STORE_FUTURE_MS_ = 300000;
const AP_STORE_MAX_CHARS_ = 200000;
const AP_STORE_DROP_CODES_ = ['url', 'gate'];

// { m, k } か null。m は本体のデプロイ ID、k は鍵(どちらも形だけ確かめる)。
function apParseHash_(hash) {
  if (typeof hash !== 'string') return null;
  const h = hash.charAt(0) === '#' ? hash.slice(1) : hash;
  const out = {};
  const parts = h.split('&');
  for (let i = 0; i < parts.length; i++) {
    const at = parts[i].indexOf('=');
    if (at === -1) continue;
    try {
      const name = decodeURIComponent(parts[i].slice(0, at));
      const value = decodeURIComponent(parts[i].slice(at + 1));
      if (name === 'm' || name === 'k') out[name] = value;
    } catch (err) {
      return null;
    }
  }
  if (typeof out.m !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(out.m)) return null;
  if (typeof out.k !== 'string' || !/^[A-Za-z0-9_-]{32,200}$/.test(out.k)) return null;
  return { m: out.m, k: out.k };
}

function apEndpoint_(m, action) {
  if (AP_ACTIONS_.indexOf(action) === -1) return null;
  return 'https://script.google.com/macros/s/' + m + '/exec?action=' + action;
}

// { status, text, ms } か { error: 'net' | 'timeout' }
function apPost_(url, obj) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, AP_TIMEOUT_MS_);
  return fetch(url, {
    method: 'POST', body: JSON.stringify(obj), credentials: 'omit', cache: 'no-store',
    redirect: 'follow', referrerPolicy: 'no-referrer', signal: ctl.signal,
  }).then(function (res) {
    return res.text().then(function (text) {
      clearTimeout(timer);
      return { status: res.status, text: text, ms: Date.now() - t0 };
    });
  }).catch(function (err) {
    clearTimeout(timer);
    return { error: err && err.name === 'AbortError' ? 'timeout' : 'net' };
  });
}

function apParseJson_(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return undefined;
  }
}

// { code } か { model }。code は render.js の vrError_ が受ける語。
function apClassify_(r) {
  if (!r || typeof r !== 'object') return { code: 'net' };
  if (r.error) return { code: r.error };
  if (r.status !== 200) return { code: 'http' };
  if (typeof r.text !== 'string' || r.text === '') return { code: 'gate' };
  const o = apParseJson_(r.text);
  if (o === undefined || o === null || typeof o !== 'object') return { code: 'json' };
  if (o.ok !== true) return { code: 'server' };
  if (o.v !== 3) return { code: 'version' };
  return { model: o };
}

// 端末の保存(最後の1回分の材料だけ。鍵とデプロイ ID は置かない)。4関数はどれも投げない。
function apStorage_() {
  try { return typeof localStorage !== 'undefined' && localStorage !== null ? localStorage : null; } catch (err) { return null; }
}

function apStoreEncode_(model, nowMs) {
  try {
    if (!model || typeof model !== 'object' || model.ok !== true || model.v !== 3 || !Number.isInteger(nowMs)) return null;
    const copy = {};
    Object.keys(model).forEach(function (key) { if (key !== 'timing') copy[key] = model[key]; });
    const text = JSON.stringify({ f: AP_STORE_FORMAT_, at: nowMs, model: copy });
    return typeof text === 'string' && text.length <= AP_STORE_MAX_CHARS_ ? text : null;
  } catch (err) {
    return null;
  }
}

function apStoreDecode_(text, nowMs) {
  try {
    if (typeof text !== 'string' || text === '') return null;
    const o = JSON.parse(text);
    if (!o || typeof o !== 'object' || Array.isArray(o) || o.f !== AP_STORE_FORMAT_ || !Number.isInteger(o.at)) return null;
    const age = nowMs - o.at;
    if (!(age >= -AP_STORE_FUTURE_MS_ && age <= AP_STORE_MAX_AGE_MS_)) return null;
    const m = o.model;
    if (!m || typeof m !== 'object' || Array.isArray(m) || m.ok !== true || m.v !== 3) return null;
    return m;
  } catch (err) {
    return null;
  }
}

function apStoreRead_(nowMs) {
  const store = apStorage_();
  if (store === null) return null;
  let text = null;
  try { text = store.getItem(AP_STORE_KEY_); } catch (err) { return null; }
  if (text === null || text === undefined) return null;
  const model = apStoreDecode_(text, nowMs);
  if (model === null) apStoreClear_();
  return model;
}

function apStoreWrite_(model, nowMs) {
  const text = apStoreEncode_(model, nowMs);
  const store = apStorage_();
  if (text === null || store === null) return false;
  try { store.setItem(AP_STORE_KEY_, text); return true; } catch (err) { return false; }
}

function apStoreClear_() {
  const store = apStorage_();
  if (store === null) return false;
  try { store.removeItem(AP_STORE_KEY_); return true; } catch (err) { return false; }
}

function apShow_(html, st) {
  document.getElementById('app').innerHTML = html;
  const clr = document.getElementById('clear');
  if (clr && st) {
    clr.addEventListener('click', function () {
      st.cleared = true;
      apStoreClear_();
      apShow_(vrCleared_(), null);
    });
  }
}

// 前回の中身があれば帯つきで先に出す。出したら true。
function apShowStale_(st, nowMs) {
  st.stale = apStoreRead_(nowMs);
  if (!st.stale) return false;
  apShow_(vrPage_(st.stale, { stale: 'loading' }), st);
  return true;
}

// 本体の返事を描く。何も描かなかったときと失敗の画面のときは null、描いたときは { html, model }。
function apOnData_(st, r, nowMs) {
  if (st.cleared) return null;
  const c = apClassify_(r);
  st.t.p_parse = apNow_();
  if (!c.model) {
    if (AP_STORE_DROP_CODES_.indexOf(c.code) !== -1) {
      apStoreClear_();
      st.stale = null;
      apShow_(vrError_(c.code), st);
    } else if (st.stale) {
      apShow_(vrPage_(st.stale, { stale: 'failed', code: c.code }), st);
    } else {
      apShow_(vrError_(c.code), st);
    }
    return null;
  }
  const html = vrPage_(c.model);
  apShow_(html, st);
  st.t.p_render = apNow_();
  apWire_(st.mk);
  apStoreWrite_(c.model, nowMs);
  return { html: html, model: c.model };
}

function apHex_() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}

// ボタン(目覚めの質問)。押したときの表示の文と aria-pressed の更新は、これまでの画面と同じ。
function apWire_(mk) {
  const out = document.getElementById('result');
  const nonces = {};
  const show = function (t) { if (out) out.textContent = t; };
  const buttons = document.querySelectorAll('button[data-label]');
  Array.prototype.forEach.call(buttons, function (b) {
    b.addEventListener('click', function () {
      const pushId = b.getAttribute('data-push-id');
      const label = b.getAttribute('data-label');
      const key = pushId + '|' + label;
      if (!nonces[key]) nonces[key] = apHex_();
      show('送信中…');
      apPost_(apEndpoint_(mk.m, 'view_page_answer'), { k: mk.k, push_id: pushId, label: label, nonce: nonces[key] }).then(function (res) {
        if (res.error) { show('通信に失敗しました。もう一度押してください。'); return; }
        const r = res.status === 200 ? apParseJson_(res.text) : undefined;
        if (!r || typeof r !== 'object') { show('記録できませんでした。'); return; }
        if (r.ok === true) {
          delete nonces[key];
          Array.prototype.forEach.call(buttons, function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
          show(r.duplicate ? '記録済みです。' : '記録しました。');
          return;
        }
        if (r.reason === 'stale_push') { show('新しい朝のメッセージがあります。開き直してください。'); return; }
        if (r.reason === 'busy' || r.retry) { show('混み合っています。もう一度押してください。'); return; }
        show('記録できませんでした。');
      });
    });
  });
}

function apNow_() {
  return Math.round(performance.now());
}

function apReportTiming_(mk, t, model, html) {
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      t.p_paint = apNow_();
      const s = model.timing;
      if (!Array.isArray(s) || s.length !== 14 || !s.every(function (v) { return typeof v === 'number' && Number.isFinite(v); })) return;
      const ua = navigator.userAgent || '';
      const uaCode = /iPhone|iPad/.test(ua) ? 2 : (/Android/.test(ua) ? 1 : 0);
      const vis = document.visibilityState === 'visible' ? 1 : 0;
      const p = [t.p_script, t.p_fetch0, t.p_fetch1, t.p_parse, t.p_render, t.p_paint, html.length, uaCode, vis];
      apPost_(apEndpoint_(mk.m, 'view_page_timing'), { k: mk.k, s: s, p: p }).then(function () {}, function () {});
    });
  });
}

function apMain_() {
  const t = {};
  t.p_script = apNow_();
  const mk = apParseHash_(location.hash);
  const st = { mk: mk, stale: null, cleared: false, t: t };
  if (mk === null) {
    apStoreClear_();
    apShow_(vrError_('url'), st);
    return;
  }
  t.p_fetch0 = apNow_();
  const pending = apPost_(apEndpoint_(mk.m, 'view_page_data'), { k: mk.k });
  apShowStale_(st, Date.now());
  pending.then(function (r) {
    t.p_fetch1 = apNow_();
    const out = apOnData_(st, r, Date.now());
    if (out) apReportTiming_(mk, t, out.model, out.html);
  });
}

if (typeof document !== 'undefined') apMain_();
