// check.js — 本体の静的ページ用の口への接続を確かめる診断(docs/plan-20261116-web-page-2.md 3章)。
// 健康データを画面に出さない。出すのは合否の語・文字数・ミリ秒だけ。鍵・URL・ID・本文は出さない・保存しない。
// 本体の ID と鍵はページの URL のフラグメント(# の後ろ)にだけ置く。

var CK_ACTIONS_ = ['view_page_data', 'view_page_answer', 'view_page_timing'];
var CK_TIMEOUT_MS_ = 25000;

function ckParseHash_(hash) {
  if (typeof hash !== 'string') return null;
  var h = hash.charAt(0) === '#' ? hash.slice(1) : hash;
  var out = {};
  var parts = h.split('&');
  for (var i = 0; i < parts.length; i++) {
    var at = parts[i].indexOf('=');
    if (at === -1) continue;
    try {
      var name = decodeURIComponent(parts[i].slice(0, at));
      var value = decodeURIComponent(parts[i].slice(at + 1));
      if (name === 'm' || name === 'k') out[name] = value;
    } catch (err) {
      return null;
    }
  }
  if (typeof out.m !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(out.m)) return null;
  if (typeof out.k !== 'string' || !/^[A-Za-z0-9_-]{32,200}$/.test(out.k)) return null;
  return { m: out.m, k: out.k };
}

function ckEndpoint_(m, action) {
  if (CK_ACTIONS_.indexOf(action) === -1) return null;
  return 'https://script.google.com/macros/s/' + m + '/exec?action=' + action;
}

// { status, text, ms } か { error: 'net' | 'timeout' }
function ckPost_(url, obj) {
  var t0 = Date.now();
  var ctl = new AbortController();
  var timer = setTimeout(function () { ctl.abort(); }, CK_TIMEOUT_MS_);
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

function ckParseJson_(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return undefined;
  }
}

// 合否の判定。ok の語・理由の語だけを返す。
function ckJudge_(r, accept) {
  if (r.error) return { pass: false, why: r.error };
  if (r.status !== 200) return { pass: false, why: 'http_' + r.status };
  return accept(r);
}

function ckUa_() {
  var ua = typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone/.test(ua)) return 'iPhone';
  return 'other';
}

function ckMain_() {
  var out = document.getElementById('out');
  var line = function (s) { out.textContent += s + '\n'; };
  var h = ckParseHash_(location.hash);
  line('0 フラグメント: ' + (h ? 'あり' : 'なし') + ' (m ' + (h ? h.m.length : 0) + '字 / k ' + (h ? h.k.length : 0) + '字)');
  if (!h) {
    line('端末: ' + ckUa_());
    return;
  }
  var data = ckEndpoint_(h.m, 'view_page_data');
  var answer = ckEndpoint_(h.m, 'view_page_answer');
  var timing = ckEndpoint_(h.m, 'view_page_timing');
  var report = function (n, label, j, extra) {
    line(n + ' ' + label + ': ' + (j.pass ? '合格' : '不合格 ' + j.why) + (extra ? ' ' + extra : ''));
  };
  var steps = [
    function () {
      return ckPost_(data, { k: h.k, dry: 1 }).then(function (r) {
        report(1, 'dry', ckJudge_(r, function (x) {
          var o = ckParseJson_(x.text);
          if (x.text === '') return { pass: false, why: 'empty' };
          if (o === undefined) return { pass: false, why: 'json' };
          return o && o.ok === true && o.dry === true && o.v === 3 ? { pass: true } : { pass: false, why: 'unexpected' };
        }), r.ms !== undefined ? r.ms + 'ms' : '');
      });
    },
    function () {
      return ckPost_(data, { k: new Array(65).join('x') }).then(function (r) {
        report(2, '違う鍵', ckJudge_(r, function (x) { return x.text === '' ? { pass: true } : { pass: false, why: 'unexpected' }; }));
      });
    },
    function () {
      return ckPost_(data, { k: h.k }).then(function (r) {
        var extra = '';
        report(3, '読み出し', ckJudge_(r, function (x) {
          if (x.text === '') return { pass: false, why: 'empty' };
          var o = ckParseJson_(x.text);
          if (o === undefined) return { pass: false, why: 'json' };
          extra = x.text.length + '字 latest ' + (o && o.latest ? 'あり' : 'なし') + ' ' + x.ms + 'ms';
          return o && o.ok === true && o.v === 3 ? { pass: true } : { pass: false, why: 'unexpected' };
        }), extra);
      });
    },
    function () {
      return ckPost_(data, { k: h.k }).then(function (r) {
        report(4, 'もう1回', ckJudge_(r, function (x) {
          var o = ckParseJson_(x.text);
          if (x.text === '') return { pass: false, why: 'empty' };
          if (o === undefined) return { pass: false, why: 'json' };
          return o && o.ok === true && o.v === 3 ? { pass: true } : { pass: false, why: 'unexpected' };
        }), r.ms !== undefined ? r.ms + 'ms' : '');
      });
    },
    function () {
      return ckPost_(answer, { k: h.k, push_id: 'check', label: '', nonce: '0' }).then(function (r) {
        report(5, 'ボタン(書かない形)', ckJudge_(r, function (x) {
          var o = ckParseJson_(x.text);
          if (x.text === '') return { pass: false, why: 'empty' };
          if (o === undefined) return { pass: false, why: 'json' };
          return o && o.ok === false && o.reason === 'bad_request' ? { pass: true } : { pass: false, why: 'unexpected' };
        }));
      });
    },
    function () {
      return ckPost_(timing, { k: h.k }).then(function (r) {
        report(6, '計測', ckJudge_(r, function (x) {
          var o = ckParseJson_(x.text);
          if (x.text === '') return { pass: false, why: 'empty' };
          if (o === undefined) return { pass: false, why: 'json' };
          return o && (o.reason === 'off' || o.reason === 'bad_request') ? { pass: true } : { pass: false, why: 'unexpected' };
        }));
      });
    },
  ];
  var chain = Promise.resolve();
  steps.forEach(function (s) { chain = chain.then(s); });
  chain.then(function () { line('端末: ' + ckUa_()); });
}

if (typeof document !== 'undefined') ckMain_();
