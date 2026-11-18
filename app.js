// app.js — 1枚の静的ページの通信と画面の差し替え(docs/plan-20261116-web-page-3.md 4章)。
// 本体の ID と鍵はページの URL のフラグメント(# の後ろ)にだけ置く。鍵とデプロイ ID は端末に保存しない。端末に残すのは本体が返した材料の最後の1回分だけ(apStorage_ の4関数。docs/plan-20261116-web-page-4.md)。
// HTML の組み立ては render.js(純関数)。ここは通信・計測・ボタンの配線だけ。

const AP_VERSION_ = 8;
const AP_ACTIONS_ = ['view_page_data', 'view_page_answer', 'view_page_timing', 'view_page_ask', 'view_page_ask_photo', 'view_page_ask_status', 'view_page_ask_seen', 'view_page_followup', 'view_page_goals', 'view_page_ask_history'];
const AP_TIMEOUT_MS_ = 25000;
// 質問する欄(docs/plan-20261117-web-ask-3.md 4-2)。長辺 px と JPEG の画質の順(1枚 1,000,000 バイト以下になるまで)。
const AP_ASK_PHOTO_TIMEOUT_MS_ = 120000;
const AP_ASK_STEPS_ = [[1568, 0.85], [1568, 0.7], [1280, 0.7], [1024, 0.6]];
const AP_ASK_POLL_MS_ = 15000;
const AP_ASK_POLL_SLOW_MS_ = 60000;
const AP_ASK_POLL_FAST_FOR_MS_ = 900000;
// 150分(安全弁の120分 + 受け皿 + 余裕)
const AP_ASK_POLL_MAX_MS_ = 9000000;
const AP_ASK_ITEMS_MAX_ = 5;
const AP_ASK_SEEN_TRIES_ = 3;
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

// { status, text, ms } か { error: 'net' | 'timeout' }。timeoutMs を省くと AP_TIMEOUT_MS_(写真は AP_ASK_PHOTO_TIMEOUT_MS_)。
function apPost_(url, obj, timeoutMs) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, typeof timeoutMs === 'number' ? timeoutMs : AP_TIMEOUT_MS_);
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

// HTML を差し込む唯一の関数(ほかの場所で HTML の文字列を書き込まない)。
function apSetHtml_(el, html) {
  el.innerHTML = html;
}

function apDot_(on) {
  const d = document.querySelector('[data-tab="ask"] .dot');
  if (d) d.hidden = !on;
}

// 4つのタブの hidden と aria-selected をそろえる。質問のタブを開いたときは apAskOnTab_。
function apTab_(st, name) {
  Array.prototype.forEach.call(document.querySelectorAll('section.tab'), function (sec) {
    sec.hidden = sec.id !== 'tab-' + name;
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) {
    b.setAttribute('aria-selected', b.getAttribute('data-tab') === name ? 'true' : 'false');
  });
  st.tab = name;
  if (name === 'ask') apAskOnTab_(st);
}

// タイルを押すと推移のタブのそのグラフへ(今朝・推移・これまでを描き直した後も配線し直す)。
function apWireGotos_(st) {
  const go = function (el) {
    const id = el.getAttribute('data-goto');
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/.test(id)) return;
    apTab_(st, 'trend');
    const target = document.getElementById('ch-' + id);
    if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView();
  };
  Array.prototype.forEach.call(document.querySelectorAll('[data-goto]'), function (el) {
    el.addEventListener('click', function () { go(el); });
    el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') go(el); });
  });
}

// グラフの列を押す(もう一度で戻す)。文は vrTipText_ が選ぶ。
function apTipOn_(st, el) {
  const hit = el && el.closest ? el.closest('rect.hit') : null;
  const pane = hit ? hit.closest('[data-r]') : null;
  const box = hit ? hit.closest('.chart') : null;
  const model = st.model ? st.model : st.stale;
  if (!pane || !box || !model || !Array.isArray(model.charts)) return;
  const rk = pane.getAttribute('data-r');
  const id = typeof box.id === 'string' ? box.id.replace(/^ch-/, '') : '';
  const entry = model.charts.filter(function (c) { return c && c.id === id; })[0];
  const chart = entry && /^d(7|28|90)$/.test(rk) ? entry[rk] : null;
  const tip = pane.querySelector('.tip');
  if (!chart || typeof chart !== 'object' || !tip) return;
  const wasOn = hit.classList.contains('on');
  const prev = pane.querySelector('rect.hit.on');
  if (prev) prev.classList.remove('on');
  if (!wasOn) hit.classList.add('on');
  tip.textContent = vrTipText_(chart, wasOn ? null : Number(hit.getAttribute('data-i')));
}

// #tab-trend の click を1つだけ受ける(委譲)。
function apWireTips_(st) {
  const tab = document.getElementById('tab-trend');
  if (!tab || typeof tab.addEventListener !== 'function') return;
  tab.addEventListener('click', function (ev) { apTipOn_(st, ev.target); });
}

function apWireTabs_(st) {
  Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) {
    b.addEventListener('click', function () { apTab_(st, b.getAttribute('data-tab')); });
  });
  apWireGotos_(st);
  apWireTips_(st);
}

function apWireClear_(st) {
  const clr = document.getElementById('clear');
  if (clr && st) {
    clr.addEventListener('click', function () {
      st.cleared = true;
      apStoreClear_();
      apShow_(vrCleared_(), null);
    });
  }
}

function apShow_(html, st) {
  apSetHtml_(document.getElementById('app'), html);
  apWireClear_(st);
  if (st && document.querySelector('[data-tab]')) apWireTabs_(st);
}

// 前回の中身があれば帯つきで先に出す。出したら true。
function apShowStale_(st, nowMs) {
  st.stale = apStoreRead_(nowMs);
  if (!st.stale) return false;
  apShow_(vrPage_(st.stale, { stale: 'loading', tab: st.tab }), st);
  return true;
}

// 今朝のタブの配線(目覚めの質問・一手と今日の一手・目標)。
function apWireToday_(st) {
  apWire_(st.mk);
  apWireFollowups_(st.mk);
  apWireGoals_(st);
}

// 本体の返事を描く。何も描かなかったときと失敗の画面のときは null、描いたときは { html, model }(refresh の html は null)。
// mode === 'refresh'(目標の保存の後)は成功のときだけ今朝・推移・これまでを差し替える(質問のタブの問い合わせと入力中の文を消さない)。
function apOnData_(st, r, nowMs, mode) {
  if (st.cleared) return null;
  const c = apClassify_(r);
  const refresh = mode === 'refresh';
  if (refresh && !c.model) {
    const o = document.getElementById('goal-out');
    if (o) o.textContent = '保存しました。読み直しはできませんでした。開き直してください。';
    return null;
  }
  if (!refresh) st.t.p_parse = apNow_();
  if (!c.model) {
    if (AP_STORE_DROP_CODES_.indexOf(c.code) !== -1) {
      apStoreClear_();
      st.stale = null;
      apShow_(vrError_(c.code), st);
    } else if (st.stale) {
      apShow_(vrPage_(st.stale, { stale: 'failed', code: c.code, tab: st.tab }), st);
    } else {
      apShow_(vrError_(c.code), st);
    }
    return null;
  }
  st.model = c.model;
  let html = null;
  if (refresh) {
    apSetHtml_(document.getElementById('tab-today'), vrTabToday_(c.model, false));
    apSetHtml_(document.getElementById('tab-trend'), vrTabTrend_(c.model));
    apSetHtml_(document.getElementById('tab-past'), vrTabPast_(c.model));
    apWireToday_(st);
    apWireGotos_(st);
    apWireClear_(st);
  } else {
    html = vrPage_(c.model, { tab: st.tab });
    apShow_(html, st);
    st.t.p_render = apNow_();
    apWireToday_(st);
    apWireAsk_(st);
  }
  apStoreWrite_(c.model, nowMs);
  if (!refresh && st.tab === 'ask') apAskOnTab_(st);
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

// ボタン(一手の記録)。押下ごとの nonce は apHex_()。結果は同じ一手のボタンの aria-pressed に反映する。
function apWireFollowups_(mk) {
  const buttons = document.querySelectorAll('button[data-fu-push]');
  Array.prototype.forEach.call(buttons, function (b) {
    b.addEventListener('click', function () {
      const pushId = b.getAttribute('data-fu-push');
      const result = b.getAttribute('data-fu-result');
      const card = b.parentNode ? b.parentNode.parentNode : null;
      const out = card ? card.querySelector('.fu-out') : null;
      const show = function (t) { if (out) out.textContent = t; };
      show('送信中…');
      apPost_(apEndpoint_(mk.m, 'view_page_followup'), { k: mk.k, push_id: pushId, result: result, nonce: apHex_() }).then(function (res) {
        if (res.error) { show('通信に失敗しました。もう一度押してください。'); return; }
        const r = res.status === 200 ? apParseJson_(res.text) : undefined;
        if (!r || typeof r !== 'object') { show('記録できませんでした。'); return; }
        if (r.ok === true) {
          Array.prototype.forEach.call(buttons, function (x) {
            if (x.getAttribute('data-fu-push') === pushId) x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
          });
          show('記録しました。');
          return;
        }
        if (r.outcome === 'too_old') { show('この一手はもう記録できません。'); return; }
        if (r.outcome === 'busy') { show('混み合っています。もう一度押してください。'); return; }
        show('記録できませんでした。');
      });
    });
  });
}

// 保存(目標)。select の選ばれた code(「なし」は送らない)だけを送り、ok なら材料を読み直して描き直す。
function apWireGoals_(st) {
  const btn = document.querySelectorAll('button[data-goal-save]')[0];
  if (!btn) return;
  btn.addEventListener('click', function () {
    const out = document.getElementById('goal-out');
    const show = function (t) { if (out) out.textContent = t; };
    const codes = [];
    Array.prototype.forEach.call(document.querySelectorAll('select[data-goal-slot]'), function (sel) {
      if (sel.value !== '') codes.push(sel.value);
    });
    show('送信中…');
    apPost_(apEndpoint_(st.mk.m, 'view_page_goals'), { k: st.mk.k, codes: codes }).then(function (res) {
      if (res.error) { show('通信に失敗しました。もう一度押してください。'); return; }
      const r = res.status === 200 ? apParseJson_(res.text) : undefined;
      if (!r || typeof r !== 'object') { show('保存できませんでした。'); return; }
      if (r.ok === true) {
        apPost_(apEndpoint_(st.mk.m, 'view_page_data'), { k: st.mk.k }).then(function (d) {
          const done = apOnData_(st, d, Date.now(), 'refresh');
          const o2 = document.getElementById('goal-out');
          if (done && o2) o2.textContent = '保存しました。';
        });
        return;
      }
      if (r.outcome === 'busy') { show('混み合っています。もう一度押してください。'); return; }
      if (r.outcome === 'bad_request') { show('選べない組み合わせです(同じ種類は1つだけ)。'); return; }
      show('保存できませんでした。');
    });
  });
}

// 長辺を edge 以下に・拡大しない・整数(純関数)。
function apAskDims_(w, h, edge) {
  const long = Math.max(w, h);
  if (!(long > edge)) return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
  const k = edge / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

function apAskB64_(blob) {
  return blob.arrayBuffer().then(function (buf) {
    const u8 = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  });
}

// { b64 } か { error: 'photo_unsupported' | 'photo_too_large' }。JPEG に描き直すので撮影情報(位置など)は送られない。
// 画像の要素も blob: の URL も作らない(CSP の img-src 'self' のまま)。
function apAskShrink_(file, maxBytes) {
  if (typeof createImageBitmap !== 'function') return Promise.resolve({ error: 'photo_unsupported' });
  const open = function () {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function (err) {
      if (err instanceof TypeError) return createImageBitmap(file);
      throw err;
    });
  };
  return open().then(function (bitmap) {
    const done = function (r) {
      try { bitmap.close(); } catch (err) { /* 握る */ }
      return r;
    };
    let i = 0;
    const step = function () {
      if (i >= AP_ASK_STEPS_.length) return Promise.resolve({ error: 'photo_too_large' });
      const s = AP_ASK_STEPS_[i++];
      const d = apAskDims_(bitmap.width, bitmap.height, s[0]);
      const canvas = document.createElement('canvas');
      canvas.width = d.w;
      canvas.height = d.h;
      const g = canvas.getContext('2d');
      if (!g) return Promise.resolve({ error: 'photo_unsupported' });
      g.drawImage(bitmap, 0, 0, d.w, d.h);
      return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', s[1]); }).then(function (blob) {
        if (!blob) return { error: 'photo_unsupported' };
        if (blob.size <= maxBytes) return apAskB64_(blob).then(function (b64) { return { b64: b64 }; });
        return step();
      });
    };
    return step().then(done, function () { return done({ error: 'photo_unsupported' }); });
  }, function () {
    return { error: 'photo_unsupported' };
  });
}

// 答えの問い合わせ(1件の枠ごと)。nonce が一致する答えだけが返る。質問・写真・答え・nonce は端末に保存しない。
// 送ってから15分までは15秒おき・その後は60秒おき(150分で終える)。画面が見えない回は送らない。
// 答えが届いたら問い合わせを止める。「見た」の知らせは、ページが見えていて質問のタブが表示中のときだけ送る。
function apAskPoll_(st, nonce, item) {
  const mk = st.mk;
  const t0 = Date.now();
  const say = function (code, info) { item.st.textContent = vrAskMsg_(code, info); };
  const delay = function () { return Date.now() - t0 < AP_ASK_POLL_FAST_FOR_MS_ ? AP_ASK_POLL_MS_ : AP_ASK_POLL_SLOW_MS_; };
  let timer = null;
  let inflight = false;
  const again = function () {
    if (item.stopped) return;
    timer = setTimeout(tick, delay());
  };
  const tick = function () {
    timer = null;
    if (item.stopped) return;
    if (Date.now() - t0 > AP_ASK_POLL_MAX_MS_) { item.stopped = true; say('poll_end'); return; }
    if (document.visibilityState !== 'visible') { again(); return; }
    if (inflight) return;
    inflight = true;
    apPost_(apEndpoint_(mk.m, 'view_page_ask_status'), { k: mk.k, nonce: nonce }).then(function (res) {
      inflight = false;
      if (item.stopped) return;
      if (res.error) { again(); return; }
      const r = res.status === 200 ? apParseJson_(res.text) : undefined;
      if (!r || typeof r !== 'object' || r.ok !== true) { item.stopped = true; say('unknown'); return; }
      if (r.state === 'answered' && r.answer && typeof r.answer === 'object') {
        item.ans.textContent = r.answer.too_long === true || typeof r.answer.text !== 'string' ? vrAskMsg_('too_long') : r.answer.text;
        item.ans.hidden = false;
        if (r.answer.line !== null && r.answer.line !== undefined) { item.stopped = true; say('line_' + String(r.answer.line)); return; }
        if (r.answer.seen === true) { item.stopped = true; say('seen'); return; }
        item.stopped = true;
        // 見えていて質問のタブが表示中のときだけ知らせる。そうでなければ点を出し、質問のタブを開いたとき(見えるようになったとき)に知らせる。
        if (document.visibilityState === 'visible' && st.tab === 'ask') { apAskSeen_(mk, nonce, item, 0); return; }
        item.nonce = nonce;
        item.pendingSeen = true;
        apDot_(true);
        return;
      }
      if (r.state === 'waiting' || r.state === 'queued') { say(r.state); again(); return; }
      item.stopped = true;
      if (r.state === 'no_answer') { say('no_answer'); return; }
      say('unknown');
    });
  };
  // 画面が見えるようになったとき、すぐ1回走らせる
  item.run = function () {
    if (item.stopped || inflight) return;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    tick();
  };
  timer = setTimeout(tick, AP_ASK_POLL_MS_);
}

// 画面が答えを表示したことを本体に知らせる(冪等)。届かなければ5秒後にもう一度(3回まで)。
// 届かなくても、本体が3分後に LINE に送る(重複して届くのは受け入れる)。
function apAskSeen_(mk, nonce, item, n) {
  apPost_(apEndpoint_(mk.m, 'view_page_ask_seen'), { k: mk.k, nonce: nonce }).then(function (res) {
    const r = !res.error && res.status === 200 ? apParseJson_(res.text) : undefined;
    if (r && typeof r === 'object' && r.ok === true && r.state === 'seen') { item.st.textContent = vrAskMsg_('seen'); return; }
    if (r && typeof r === 'object' && r.ok === true && r.state === 'line') { item.st.textContent = vrAskMsg_('line_' + String(r.line)); return; }
    if (n + 1 < AP_ASK_SEEN_TRIES_) setTimeout(function () { apAskSeen_(mk, nonce, item, n + 1); }, 5000);
  });
}

// いま配線している質問欄(visibilitychange のリスナーは1つだけ。最後に配線したものを見る)。
let apAskUi_ = null;
let apAskVisBound_ = false;

// 質問のタブを開いた(または見えるようになった)とき。見えていれば、点を出していた答えと履歴の中の未表示の答えに「見た」を知らせる。
// 履歴は1回のページの表示で1回だけ読む(再読み込みのボタンは作らない)。
function apAskOnTab_(st) {
  if (document.visibilityState === 'visible') {
    if (apAskUi_ !== null) {
      apAskUi_.items.forEach(function (it) {
        if (it.pendingSeen) {
          it.pendingSeen = false;
          apAskSeen_(st.mk, it.nonce, it, 0);
        }
      });
    }
    apDot_(false);
    Object.keys(st.histRefs).forEach(function (i) {
      const el = document.querySelector('#ask-hist [data-h="' + i + '"] .ask-st');
      const nonce = st.histRefs[i];
      delete st.histRefs[i];
      if (el) apAskSeen_(st.mk, nonce, { st: el }, 0);
    });
  }
  if (!st.hist && !st.histBusy && st.model && st.model.ask && st.model.ask.on === true) apAskHistory_(st);
}

// 履歴(view_page_ask_history)を #ask-hist に出す。読めなければ「読み込めませんでした」(次に質問のタブを開いたとき読み直す)。
function apAskHistory_(st) {
  const box = document.getElementById('ask-hist');
  if (!box) return;
  st.histBusy = true;
  apPost_(apEndpoint_(st.mk.m, 'view_page_ask_history'), { k: st.mk.k }).then(function (res) {
    st.histBusy = false;
    const r = !res.error && res.status === 200 ? apParseJson_(res.text) : undefined;
    const ok = !!r && typeof r === 'object' && r.ok === true;
    apSetHtml_(box, vrAskHistory_(ok ? r : { ok: false }));
    if (!ok) return;
    st.hist = true;
    st.histRefs = {};
    (Array.isArray(r.items) ? r.items : []).forEach(function (it, i) {
      if (it && typeof it === 'object' && typeof it.ref === 'string' && /^[0-9a-f]{32}$/.test(it.ref)) st.histRefs[i] = it.ref;
    });
    if (document.visibilityState === 'visible' && st.tab === 'ask') apAskOnTab_(st);
  });
}

// 質問する欄の配線(#ask-send が無ければ何もしない)。
function apWireAsk_(st) {
  const mk = st.mk;
  const model = st.model;
  const btn = document.getElementById('ask-send');
  if (!btn) return;
  const ask = model && model.ask && typeof model.ask === 'object' ? model.ask : {};
  const num = function (v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; };
  const textMax = num(ask.text_max, 1000);
  const noteMax = num(ask.note_max, 100);
  const photoMax = num(ask.photo_max, 4);
  const photoBytes = num(ask.photo_bytes, 1000000);
  const textEl = document.getElementById('ask-text');
  const photoEl = document.getElementById('ask-photo');
  const list = document.getElementById('ask-list');
  const ui = { status: document.getElementById('ask-status'), list: list, items: [], st: st };
  const memo = { sig: '', nonce: '' };
  const say = function (code, info) { ui.status.textContent = vrAskMsg_(code, info); };
  apAskUi_ = ui;
  if (!apAskVisBound_) {
    apAskVisBound_ = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || apAskUi_ === null) return;
      apAskUi_.items.forEach(function (it) { if (typeof it.run === 'function') it.run(); });
      if (apAskUi_.st.tab === 'ask') apAskOnTab_(apAskUi_.st);
    });
  }

  // 送れた質問の枠を #ask-list の末尾に1件作る(textContent だけ)。5件を超えたら最も古い枠を外して問い合わせを止める。
  const makeItem = function (label) {
    const wrap = document.createElement('div');
    wrap.className = 'ask-item';
    const q = document.createElement('p');
    q.className = 'ask-q';
    q.textContent = label;
    const st = document.createElement('p');
    st.className = 'ask-st';
    st.setAttribute('role', 'status');
    const ans = document.createElement('div');
    ans.className = 'ans';
    ans.hidden = true;
    wrap.appendChild(q);
    wrap.appendChild(st);
    wrap.appendChild(ans);
    if (list) list.appendChild(wrap);
    const item = { wrap: wrap, st: st, ans: ans, stopped: false, run: null };
    ui.items.push(item);
    while (ui.items.length > AP_ASK_ITEMS_MAX_) {
      const old = ui.items.shift();
      old.stopped = true;
      if (old.wrap.parentNode) old.wrap.parentNode.removeChild(old.wrap);
    }
    return item;
  };

  const finish = function (res, nonce, label) {
    btn.disabled = false;
    if (res.error) { say(res.error); return; }
    const r = res.status === 200 ? apParseJson_(res.text) : undefined;
    if (!r || typeof r !== 'object') { say('other'); return; }
    if (r.ok === true) {
      textEl.value = '';
      if (photoEl) photoEl.value = '';
      memo.sig = '';
      memo.nonce = '';
      say('');
      const item = makeItem(label);
      item.st.textContent = vrAskMsg_(r.queued === true ? 'queued' : 'waiting');
      apAskPoll_(st, nonce, item);
      return;
    }
    if (r.reason === 'wake_failed') { memo.sig = ''; memo.nonce = ''; }
    say(typeof r.reason === 'string' ? r.reason : 'other');
  };

  btn.addEventListener('click', function () {
    const text = textEl.value;
    const files = photoEl && photoEl.files ? Array.prototype.slice.call(photoEl.files) : [];
    if (files.length > photoMax) { say('photo_too_many'); return; }
    if (files.length > 0 && text.length > noteMax) { say('note_too_long'); return; }
    if (files.length === 0 && text.trim() === '') { say('empty'); return; }
    if (text.length > textMax) { say('too_long_text'); return; }
    const sig = JSON.stringify([text, files.map(function (f) { return [f.name, f.size, f.lastModified]; })]);
    if (memo.nonce === '' || sig !== memo.sig) { memo.nonce = apHex_(); memo.sig = sig; }
    const nonce = memo.nonce;
    const label = files.length === 0 ? text.trim() : '写真' + files.length + '枚' + (text.trim() === '' ? '' : '(' + text.trim() + ')');
    btn.disabled = true;
    if (files.length === 0) {
      say('sending');
      apPost_(apEndpoint_(mk.m, 'view_page_ask'), { k: mk.k, nonce: nonce, push_id: apPushIdOf_(st), text: text }).then(function (res) { finish(res, nonce, label); });
      return;
    }
    say('shrinking');
    const out = [];
    const next = function (i) {
      if (i >= files.length) {
        say('sending');
        apPost_(apEndpoint_(mk.m, 'view_page_ask_photo'), { k: mk.k, nonce: nonce, text: text, photos: out }, AP_ASK_PHOTO_TIMEOUT_MS_).then(function (res) { finish(res, nonce, label); });
        return;
      }
      apAskShrink_(files[i], photoBytes).then(function (r) {
        if (r.error) { btn.disabled = false; say(r.error); return; }
        out.push(r.b64);
        next(i + 1);
      });
    };
    next(0);
  });
}

// 送るときの push_id(描き直しの後も新しい朝に付く)。
function apPushIdOf_(st) {
  const m = st.model;
  return m && m.latest && typeof m.latest.push_id === 'string' ? m.latest.push_id : '';
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
  const st = { mk: mk, stale: null, cleared: false, t: t, tab: 'today', model: null, hist: false, histBusy: false, histRefs: {} };
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
