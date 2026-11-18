// render.js — 1枚の静的ページの描画(純関数だけ。docs/plan-20261116-web-page-3.md 2章)。
// 本体の材料 v3(webViewPageModel_)を受け取り、HTML と SVG の文字列を返す。DOM・通信・端末の保存・時計には触れない。
// 値・目盛り・平均・日付の文字列は本体が作ったものを写すだけで、ここでは座標の計算だけをする。
// 関数名・定数名は _ で終える(GAS にそのまま写せる形。viewer/ の描画と同じ出力を目指す)。
// モデル由来の文字列は必ず vrEsc_ を通す。色は種類の区別だけで、良し悪しでは塗らない。

const VR_VERSION_ = 9;

// 種類 -> 色のクラス(cls は文字と見出し・k はグラフの濃淡)・アイコン・名前。区分の無い・未知の値は VR_GROUP_OTHER_。
const VR_GROUPS_ = {
  sleep: { cls: 'c-sleep', k: 'k-sleep', icon: 'i-moon', name: '睡眠' },
  recovery: { cls: 'c-heart', k: 'k-heart', icon: 'i-heart', name: '回復' },
  activity: { cls: 'c-act', k: 'k-act', icon: 'i-flame', name: '活動' },
};
const VR_GROUP_OTHER_ = { cls: 'c-neu', k: 'k-other', icon: 'i-chart', name: '指標' };
const VR_GROUP_ORDER_ = ['sleep', 'recovery', 'activity'];

const VR_TEXT_ = {
  error: '記録を読み込めませんでした。少し待って開き直してください。',
  url: 'このページの URL が正しくありません。ホーム画面のアイコンを作り直してください。',
  none: 'この期間の記録はありません。',
  empty: 'まだ朝のメッセージがありません。',
  clear: 'この端末の記録を消す',
  cleared: 'この端末に残した記録を消しました。次に開くと本体から読み直し、また最後の1回分だけ残します。',
  stale_prev: '前回の記録',
  ask_loading: '読み込み中…',
  ask_failed: '読み込めませんでした。開き直してください。',
  ask_intro: 'お返事はこの画面に出ます。できてから3分ほど、この「質問」のタブで見ていないときは LINE に届きます。',
  hist_head: 'これまでのやり取り(7日)',
  hist_loading: '読み込んでいます…',
  hist_failed: 'これまでのやり取りを読み込めませんでした。',
  hist_none: 'この7日のやり取りはありません。',
};
const VR_TABS_ = [['today', '今朝'], ['trend', '推移'], ['ask', '質問'], ['past', 'これまで']];
// 質問する欄の文(docs/plan-20261117-web-ask-3.md 4-1)。waiting の {until} は vrAskMsg_ が差し込む。
const VR_ASK_TEXT_ = {
  sending: '送信中…',
  shrinking: '写真を縮めて送っています…',
  waiting: '受け取りました。お返事を書いています。',
  queued: '受け取りました。前のお返事の後に書きます。',
  seen: 'この画面でお返事を表示しました。LINE には送りません。',
  line_push: 'このお返事は LINE にも送りました。',
  line_push_floor: 'このお返事は LINE にも送りました。',
  line_queued: '今月は LINE で送れる数が残り少ないため、LINE には次の朝のメッセージと一緒に届きます。',
  line_dropped: 'LINE には送れませんでした。',
  line_failed: 'LINE には送れませんでした。',
  too_long: 'お返事が長いため画面には出せません。LINE をご確認ください。',
  no_answer: 'お返事を作れませんでした。少し時間をおいて、もう一度送ってください。',
  unknown: '状況を確かめられませんでした。お返事は LINE に届きます。',
  poll_end: '確認を終えました。お返事は LINE に届きます。',
  busy: 'いまは順番を待っている質問が多いため、受け付けられませんでした。少し待ってから送ってください。',
  day_limit: '今日はこれ以上、質問を受け付けられません。明日また送ってください。',
  off: '今は画面から質問できません。LINE で送ってください。',
  photo_off: '今は画面から質問できません。LINE で送ってください。',
  stale_push: '新しい朝のメッセージがあります。開き直してください。',
  wake_failed: '質問は記録しましたが、いまはお返事を作れません。少し時間をおいて送り直すか、LINE で送ってください。',
  empty: '質問を入力してください。',
  too_long_text: '1,000字までにしてください。',
  note_too_long: '写真に添える一言は100字までにしてください。',
  photo_too_many: '写真は4枚までです。',
  photo_too_large: '写真を小さくできませんでした。LINE で送ってください。',
  photo_unsupported: 'この端末では画面から写真を送れません。LINE で送ってください。',
  net: '通信に失敗しました。もう一度送ってください。',
  timeout: '通信に失敗しました。もう一度送ってください。',
};
const VR_ASK_TEXT_OTHER_ = '送れませんでした。';
const VR_ERROR_CODES_ = ['url', 'net', 'timeout', 'gate', 'http', 'json', 'server', 'version'];
const VR_PUSH_ID_PATTERN_ = /^[A-Za-z0-9-]{1,80}$/;

const VR_SVG_WIDTH_ = 340;
const VR_SVG_PLOT_HEIGHT_ = 150;
const VR_SVG_LEFT_ = 4;
const VR_SVG_AXIS_WIDTH_ = 44;
const VR_SVG_TOP_ = 10;
const VR_SVG_DATE_ROW_ = 24;

// 小さな推移(タイルの中)。
const VR_SPARK_W_ = 120;
const VR_SPARK_H_ = 28;

// アイコン(端末内の SVG。外部の読み込みなし。色は currentColor か none だけ)。
const VR_SPRITE_ = '<svg class="spr" aria-hidden="true">'
  + '<symbol id="i-moon" viewBox="0 0 24 24"><path fill="currentColor" d="M20 15.5A8.5 8.5 0 0 1 8.5 4a8.5 8.5 0 1 0 11.5 11.5z"/></symbol>'
  + '<symbol id="i-heart" viewBox="0 0 24 24"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.5 5c2 0 3.6 1.1 4.5 2.6l1 1.4 1-1.4C13.9 6.1 15.5 5 17.5 5 21 5 23.1 8.4 21.6 11.8 19.5 16.4 12 21 12 21z"/></symbol>'
  + '<symbol id="i-flame" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2s5 4.5 5 9.5a5 5 0 0 1-10 0c0-2 1-3.5 1-3.5s.5 2 2 2.5C10 7 12 2 12 2zm0 20a7 7 0 0 0 7-7c0 2-2 4-4 4a3 3 0 0 1-3-3 3 3 0 0 1-3 3c-2 0-4-2-4-4a7 7 0 0 0 7 7z"/></symbol>'
  + '<symbol id="i-chat" viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></symbol>'
  + '<symbol id="i-check" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/><path class="ckm" d="M7 12.5l3.2 3L17 9" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></symbol>'
  + '<symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1.5v2.5M12 20v2.5M1.5 12H4M20 12h2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></g></symbol>'
  + '<symbol id="i-chart" viewBox="0 0 24 24"><g fill="currentColor"><rect x="3" y="12" width="4" height="9" rx="1.5"/><rect x="10" y="7" width="4" height="14" rx="1.5"/><rect x="17" y="3" width="4" height="18" rx="1.5"/></g></symbol>'
  + '</svg>';

function vrEsc_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function vrAskMsg_(code, info) {
  if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(VR_ASK_TEXT_, code)) return VR_ASK_TEXT_OTHER_;
  const t = VR_ASK_TEXT_[code];
  if (code !== 'waiting') return t;
  const until = info && typeof info === 'object' && typeof info.until === 'string' && /^\d{1,2}:\d{2}$/.test(info.until) ? info.until : '';
  return until !== '' ? t.replace('{until}', until) : t.replace('({until}ごろまで)', '');
}

function vrNum_(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function vrArr_(v) {
  return Array.isArray(v) ? v : [];
}

function vrStr_(v) {
  return typeof v === 'string' && v !== '' ? v : '';
}

// 値の文字列を、数字の片はそのまま・単位などの片は <small> にして返す。字を足さない・消さない・数として読まない。
function vrValueHtml_(s) {
  const pieces = String(s === null || s === undefined ? '' : s).match(/[+\-±]?[0-9][0-9.,:]*|[^0-9+\-±]+|[+\-±]/g) || [];
  return pieces.map(function (p) {
    return /^[+\-±]?[0-9]/.test(p) ? vrEsc_(p) : '<small>' + vrEsc_(p) + '</small>';
  }).join('');
}

function vrParas_(text, cls) {
  return String(text === null || text === undefined ? '' : text).split(/\n+/).filter(function (t) { return t.trim() !== ''; }).map(function (t) {
    return '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + vrEsc_(t) + '</p>';
  }).join('');
}

function vrIcon_(icon) {
  return '<svg><use href="#' + icon + '"/></svg>';
}

function vrGroupInfo_(g) {
  return typeof g === 'string' && Object.prototype.hasOwnProperty.call(VR_GROUPS_, g) ? VR_GROUPS_[g] : VR_GROUP_OTHER_;
}

function vrHead_(info, title) {
  return '<div class="head ' + info.cls + '">' + vrIcon_(info.icon) + vrEsc_(title) + '</div>';
}

// 0〜100 の整数の長さの棒。数でなければ棒なし。
function vrBar_(pct, cls) {
  const n = vrNum_(pct);
  if (n === null) return '';
  const w = Math.max(0, Math.min(100, Math.round(n)));
  return '<svg class="bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="tr" width="100" height="10" rx="5"/>'
    + '<rect class="' + cls + '" width="' + w + '" height="10" rx="5"/></svg>';
}

// 1. 日付の行
function vrDate_(latest, noPress) {
  const dateText = vrStr_(latest.date_label) !== '' ? latest.date_label : latest.date;
  return '<p class="date">' + vrEsc_(dateText) + ' ' + vrEsc_(latest.time) + '</p>'
    + '<h1>' + (latest.is_today === true && !noPress ? '今朝' : '直近の朝') + '</h1>';
}

// 2. 睡眠のカード(評価の文か sleep_bars があるとき)。右に時刻を出さない。
function vrSleep_(latest) {
  const bars = latest.sleep_bars && typeof latest.sleep_bars === 'object' ? latest.sleep_bars : null;
  const hasLine = vrStr_(latest.sleep_verdict_line) !== '';
  if (!hasLine && bars === null) return '';
  let out = '<div class="card sl">' + vrHead_(VR_GROUPS_.sleep, '睡眠');
  if (hasLine) out += '<p class="lead">' + vrEsc_(latest.sleep_verdict_line) + '</p>';
  if (bars !== null) {
    const row = function (label, value, pct, cls) {
      const bar = vrBar_(pct, cls);
      return '<span class="k">' + vrEsc_(label) + '</span><span class="v num">' + vrValueHtml_(value) + '</span>'
        + (bar === '' ? '' : '<span></span>' + bar);
    };
    out += '<div class="cmp">' + row(bars.day === null || bars.day === undefined ? '' : bars.day, bars.today, bars.today_pct, 'ts')
      + row('28日平均', bars.d28, bars.d28_pct, 'ta') + '</div>';
  }
  return out + '</div>';
}

// 目覚めの質問のカード・記録済みの行(3)。canPress のとき true で、本文に問いを出さない。
function vrWakeState_(latest, noPress) {
  const labels = vrArr_(latest.labels).filter(function (l) { return typeof l === 'string' && l !== ''; });
  const canPress = !noPress && labels.length > 0 && typeof latest.push_id === 'string' && VR_PUSH_ID_PATTERN_.test(latest.push_id);
  const a = latest.answer && typeof latest.answer === 'object' ? latest.answer : null;
  return { labels: labels, canPress: canPress, answer: a };
}

function vrAnswerLine_(a) {
  return '記録済み: ' + vrEsc_(a.label) + '・' + vrEsc_(a.origin) + ' ' + vrEsc_(a.at);
}

function vrWake_(latest, noPress) {
  const s = vrWakeState_(latest, noPress);
  const coda = vrStr_(latest.coda_text);
  if (!s.canPress) {
    return s.answer !== null ? '<p class="saved">' + vrAnswerLine_(s.answer) + '</p>' : '';
  }
  const buttons = '<div class="seg">' + s.labels.map(function (l) {
    return '<button type="button" data-push-id="' + vrEsc_(latest.push_id) + '" data-label="' + vrEsc_(l) + '" aria-pressed="'
      + (s.answer !== null && s.answer.label === l ? 'true' : 'false') + '">' + vrEsc_(l) + '</button>';
  }).join('') + '</div><p id="result" role="status"></p>';
  const q = coda !== '' ? '<p class="q">' + vrEsc_(coda) + '</p>' : '';
  if (s.answer === null) {
    return '<div class="card wake">' + vrHead_({ cls: 'c-mind', icon: 'i-sun' }, '今朝の問い') + q + buttons + '</div>';
  }
  return '<details class="card ans"><summary>' + vrIcon_('i-check') + vrAnswerLine_(s.answer) + '</summary>' + q + buttons + '</details>';
}

// 3b. 一手の記録(coach.followups)。coach が無ければ何も出さない。ボタンの配線は app.js(apWireFollowups_)。
function vrCoachFollowups_(model, noPress) {
  const c = model && typeof model === 'object' && model.coach && typeof model.coach === 'object' ? model.coach : null;
  if (c === null) return '';
  const todayId = c.today && typeof c.today === 'object' && typeof c.today.push_id === 'string' ? c.today.push_id : '';
  const list = vrArr_(c.followups).filter(function (f) { return f && typeof f === 'object' && typeof f.push_id === 'string' && VR_PUSH_ID_PATTERN_.test(f.push_id) && !(todayId !== '' && f.push_id === todayId); });
  if (list.length === 0) return '';
  const labels = vrArr_(c.labels).filter(function (l) { return l && typeof l === 'object' && typeof l.id === 'string' && typeof l.label === 'string' && l.label !== ''; });
  const cards = list.map(function (f) {
    const when = typeof f.when === 'string' && f.when !== '' ? '<p class="sub">' + vrEsc_(f.when) + '</p>' : '';
    const rec = typeof f.result_label === 'string' && f.result_label !== '' ? '記録: ' + vrEsc_(f.result_label) : 'まだ記録がありません';
    const buttons = noPress ? '' : '<div class="seg">' + labels.map(function (l) {
      return '<button type="button" data-fu-push="' + vrEsc_(f.push_id) + '" data-fu-result="' + vrEsc_(l.id) + '" aria-pressed="'
        + (f.result === l.id ? 'true' : 'false') + '">' + vrEsc_(l.label) + '</button>';
    }).join('') + '</div><p class="fu-out" role="status"></p>';
    return '<p class="fu-what">' + vrEsc_(f.date_label) + ' ' + vrEsc_(f.what) + '</p>' + when + '<p class="saved">' + rec + '</p>' + buttons;
  }).join('');
  return '<div class="card fu">' + vrHead_({ cls: 'c-mind', icon: 'i-check' }, '一手の記録') + cards + '</div>';
}

// 3a. 今日の一手(coach.today。最後の push が今日のときだけ)。ボタンの配線は apWireFollowups_(一手の記録と同じ)。
function vrCoachToday_(model, noPress) {
  const c = model && typeof model === 'object' && model.coach && typeof model.coach === 'object' ? model.coach : null;
  const t = c !== null && c.today && typeof c.today === 'object' ? c.today : null;
  if (t === null || typeof t.push_id !== 'string' || !VR_PUSH_ID_PATTERN_.test(t.push_id)) return '';
  const labels = vrArr_(c.labels).filter(function (l) { return l && typeof l === 'object' && typeof l.id === 'string' && typeof l.label === 'string' && l.label !== ''; });
  const rec = typeof t.result_label === 'string' && t.result_label !== '' ? '記録: ' + vrEsc_(t.result_label) : 'まだ記録がありません';
  const buttons = noPress ? '' : '<div class="seg">' + labels.map(function (l) {
    return '<button type="button" data-fu-push="' + vrEsc_(t.push_id) + '" data-fu-result="' + vrEsc_(l.id) + '" aria-pressed="'
      + (t.result === l.id ? 'true' : 'false') + '">' + vrEsc_(l.label) + '</button>';
  }).join('') + '</div><p class="fu-out" role="status"></p>';
  return '<div class="card today">' + vrHead_({ cls: 'c-mind', icon: 'i-check' }, '今日の一手')
    + '<p class="lead">' + vrEsc_(t.what) + '</p>'
    + (typeof t.when === 'string' && t.when !== '' ? '<p class="sub">' + vrEsc_(t.when) + '</p>' : '')
    + '<p class="saved">' + rec + '</p>' + buttons
    + '<p class="sub">夜に記録すると、翌朝のメッセージに使われます。</p></div>';
}

// 3c. 目標(coach.goals / goal_choices / goal_max)。coach が無ければ何も出さない。保存の配線は app.js(apWireGoals_)。
// 今の目標の文と「M月D日(曜)から」(since_label)。!noPress のときだけ goal_max 個の select(「なし」+ 選択肢)と保存ボタン。
function vrCoachGoals_(model, noPress) {
  const c = model && typeof model === 'object' && model.coach && typeof model.coach === 'object' ? model.coach : null;
  if (c === null) return '';
  const goals = vrArr_(c.goals).filter(function (g) { return g && typeof g === 'object' && typeof g.text === 'string' && g.text !== ''; });
  const groups = vrArr_(c.goal_choices).filter(function (g) { return g && typeof g === 'object' && Array.isArray(g.choices); });
  const max = vrNum_(c.goal_max);
  const now = goals.length === 0 ? '<p class="saved">目標はまだ決めていません</p>' : goals.map(function (g) {
    const since = typeof g.since_label === 'string' && g.since_label !== '' ? '<p class="sub">' + vrEsc_(g.since_label) + '</p>' : '';
    const line = typeof g.latest_line === 'string' && g.latest_line !== '' ? '<p class="sub">' + vrEsc_(g.latest_line) + '</p>' : '';
    return '<p class="goal-text">' + vrEsc_(g.text) + '</p>' + since + line;
  }).join('');
  let form = '';
  if (!noPress && max !== null && max > 0 && groups.length > 0) {
    let selects = '';
    for (let i = 0; i < max; i++) {
      const cur = goals[i] && typeof goals[i].code === 'string' ? goals[i].code : '';
      selects += '<select data-goal-slot="' + i + '" aria-label="目標 ' + (i + 1) + '"><option value="">なし</option>' + groups.map(function (g) {
        return '<optgroup label="' + vrEsc_(vrStr_(g.name)) + '">' + vrArr_(g.choices).filter(function (x) { return x && typeof x.code === 'string' && typeof x.text === 'string'; }).map(function (x) {
          return '<option value="' + vrEsc_(x.code) + '"' + (x.code === cur ? ' selected' : '') + '>' + vrEsc_(x.text) + '</option>';
        }).join('') + '</optgroup>';
      }).join('') + '</select>';
    }
    form = '<details class="gedit"><summary>目標を変える</summary><div class="goal-form">' + selects + '<button type="button" data-goal-save="1">保存</button></div></details><p class="goal-out" id="goal-out" role="status"></p>';
  }
  return '<div class="card goal">' + vrHead_({ cls: 'c-mind', icon: 'i-check' }, '目標') + now + form
    + '<p class="sub">目標は翌朝から使われます(5時より前に決めた目標はその朝から)。</p></div>';
}

// 3d. 週の振り返り(coach.weekly = { date_label, text })。無ければ何も出さない。過去の朝の前に畳んで置く。
function vrCoachWeekly_(model) {
  const c = model && typeof model === 'object' && model.coach && typeof model.coach === 'object' ? model.coach : null;
  const w = c !== null && c.weekly && typeof c.weekly === 'object' ? c.weekly : null;
  if (w === null || vrStr_(w.text) === '') return '';
  const when = vrStr_(w.date_label).replace(/\([^()]*\)$/, '');
  return '<details class="card pastwrap" open><summary>週の振り返り' + (when !== '' ? '(' + vrEsc_(when) + ')' : '') + '</summary><div class="in">' + vrParas_(w.text, '') + '</div></details>';
}

// 4. 本文(評価の文を抜いたもの)。3 でカードを出さず coda_text があれば、問いをここに出す。
function vrMsg_(latest, noPress) {
  const s = vrWakeState_(latest, noPress);
  const coda = vrStr_(latest.coda_text);
  return '<div class="card msg">' + vrHead_({ cls: 'c-neu', icon: 'i-chat' }, latest.is_today === true && !noPress ? '今朝のメッセージ' : '直近の朝のメッセージ')
    + vrParas_(latest.body_rest, '') + (!s.canPress && coda !== '' ? '<p class="coda">' + vrEsc_(coda) + '</p>' : '') + '</div>';
}

// 5. 質問する欄。ask.on が true で push_id が読めるときだけ。入力欄・ボタンの配線は app.js(apWireAsk_)。
function vrAsk_(latest, ask) {
  if (!ask || typeof ask !== 'object' || ask.on !== true) return '';
  if (!latest || typeof latest !== 'object' || typeof latest.push_id !== 'string' || !VR_PUSH_ID_PATTERN_.test(latest.push_id)) return '';
  const pick = function (v, d) { const n = vrNum_(v); return n === null ? d : n; };
  const textMax = pick(ask.text_max, 1000);
  const noteMax = pick(ask.note_max, 100);
  const photoMax = pick(ask.photo_max, 4);
  const photo = ask.photo === true
    ? '<p><input type="file" id="ask-photo" accept="image/*" multiple></p><p class="hint">写真は' + vrEsc_(photoMax) + '枚まで。添える一言は' + vrEsc_(noteMax) + '字まで。</p>'
    : '';
  return '<div class="card ask">' + vrHead_({ cls: 'c-neu', icon: 'i-chat' }, '質問する')
    + '<textarea id="ask-text" maxlength="' + vrEsc_(textMax) + '" rows="3" aria-label="質問"></textarea>'
    + photo
    + '<p><button type="button" id="ask-send">送る</button></p>'
    + '<p id="ask-status" role="status"></p>'
    + (vrNum_(ask.today) !== null ? '<p class="hint">今日、画面から受け付けた質問: ' + vrEsc_(ask.today) + '件</p>' : '') + '</div><div id="ask-list"></div>';
}

// 小さな推移(28日の値。null で線を切る)。
function vrSpark_(sp) {
  if (!sp || typeof sp !== 'object') return '';
  const vals = vrArr_(sp.vals);
  const n = vals.length;
  const lo = vrNum_(sp.lo);
  const hi = vrNum_(sp.hi);
  if (n < 2 || lo === null || hi === null || !(hi > lo)) return '';
  const r1 = function (v) { return Math.round(v * 10) / 10; };
  const x = function (i) { return r1(2 + i * 116 / (n - 1)); };
  const y = function (v) {
    return sp.down === true ? r1(2 + 24 * (v - lo) / (hi - lo)) : r1(2 + 24 * (hi - v) / (hi - lo));
  };
  let d = '';
  let run = [];
  let last = null;
  const flush = function () {
    if (run.length === 1) d += 'M' + run[0].x + ' ' + run[0].y + 'h.1';
    else if (run.length > 1) d += run.map(function (p, j) { return (j === 0 ? 'M' : 'L') + p.x + ' ' + p.y; }).join('');
    run = [];
  };
  vals.forEach(function (v, i) {
    const f = vrNum_(v);
    if (f === null) { flush(); return; }
    last = { x: x(i), y: y(f) };
    run.push(last);
  });
  flush();
  if (last === null) return '';
  const avg = vrNum_(sp.avg);
  return '<svg class="sp" viewBox="0 0 ' + VR_SPARK_W_ + ' ' + VR_SPARK_H_ + '" aria-hidden="true">'
    + (avg !== null ? '<path class="sa" d="M2 ' + y(avg) + 'H118"/>' : '')
    + '<path class="sl" d="' + d + '"/><circle class="se" cx="' + last.x + '" cy="' + last.y + '" r="2.5"/></svg>';
}

// 開いたときのグラフ1枚(7日か28日)。注記と時点はここに出さない(最下部に1回)。
function vrPanel_(chart, tileName) {
  if (!chart || typeof chart !== 'object') return '<p class="none">' + VR_TEXT_.none + '</p>';
  const info = vrGroupInfo_(chart.group);
  const hasValues = Array.isArray(chart.legend_values) && chart.legend_values.length > 0;
  const keys = [];
  if (Array.isArray(chart.legend) && chart.legend.length === 3) {
    ['kd', 'kr', 'kl'].forEach(function (k, i) {
      const v = hasValues && typeof chart.legend_values[i] === 'string' ? ' ' + chart.legend_values[i] : '';
      keys.push('<span><b class="' + k + '"></b>' + vrEsc_(chart.legend[i] + v) + '</span>');
    });
  }
  vrArr_(chart.avgs).forEach(function (a) {
    if (a && typeof a === 'object') keys.push('<span><i class="ka"></i>' + vrEsc_(a.text) + '</span>');
  });
  return '<div class="pnl ' + info.k + '">'
    + (chart.title !== tileName ? '<p class="ct">' + vrEsc_(chart.title) + '</p>' : '')
    + '<p class="when">' + vrEsc_(hasValues ? chart.when : chart.sub) + ' ・ ' + vrEsc_(chart.headline) + '</p>'
    + vrSvg_(chart) + (keys.length > 0 ? '<div class="keys">' + keys.join('') + '</div>' : '') + '</div>';
}

// タイル1枚(平たい。グラフと小さな線は出さない)。グラフのある指標(chart が c + 数字)は押すと推移のタブのそのグラフへ。
function vrTile_(f, n) {
  const info = vrGroupInfo_(f.group);
  const band = vrStr_(f.band) !== '' && f.band_usual !== true ? f.band : '';
  const head = '<div class="head ' + info.cls + '">' + vrIcon_(info.icon) + vrEsc_(f.name) + '</div>';
  const body = '<div class="big num">' + vrValueHtml_(f.today) + '</div>'
    + (vrStr_(f.d28) !== '' ? '<div class="avg">平均 ' + vrEsc_(f.d28) + '</div>' : '')
    + (band !== '' ? '<span class="pill">' + vrEsc_(band) + '</span>' : '');
  if (typeof f.chart === 'string' && /^c[0-9]+$/.test(f.chart)) {
    return '<div class="tile go" role="button" tabindex="0" data-goto="' + vrEsc_(f.chart) + '">' + head + body + '</div>';
  }
  return '<div class="tile flat">' + head + body + '</div>';
}

// 指標のタイル(睡眠 → 回復 → 活動 → 区分なし)。sleep_bars と同じ名前のタイルはカードと重複するので出さない。
function vrTiles_(latest) {
  if (!latest || typeof latest !== 'object') return '';
  const bars = latest.sleep_bars && typeof latest.sleep_bars === 'object' ? latest.sleep_bars : null;
  const facts = vrArr_(latest.facts).filter(function (f) {
    return f && typeof f === 'object' && !(bars !== null && typeof bars.name === 'string' && f.name === bars.name);
  });
  const order = VR_GROUP_ORDER_.concat(['']);
  const keyOf = function (f) { return VR_GROUP_ORDER_.indexOf(f.group) !== -1 ? f.group : ''; };
  let n = 0;
  return order.map(function (k) {
    const items = facts.filter(function (f) { return keyOf(f) === k; });
    if (items.length === 0) return '';
    const info = k === '' ? VR_GROUP_OTHER_ : VR_GROUPS_[k];
    const day = vrStr_(items[0].day) !== '' && items.every(function (f) { return f.day === items[0].day; }) ? items[0].day : '';
    return '<div class="sec"><h2>' + vrEsc_(info.name) + '</h2>' + (day !== '' ? '<span>' + vrEsc_(day) + '</span>' : '') + '</div>'
      + '<div class="grid">' + items.map(function (f) { const t = vrTile_(f, n); n += 1; return t; }).join('') + '</div>';
  }).join('');
}

// 6. 過去7日の朝(畳まない。各朝の中身は各 <details>)。0件なら何も出さない。
function vrPast_(past) {
  const list = vrArr_(past);
  if (list.length === 0) return '';
  return '<div class="sec"><h2>過去7日の朝</h2></div><div class="card plist"><div class="list">' + list.map(function (p) {
    const x = p && typeof p === 'object' ? p : {};
    const replies = vrArr_(x.replies);
    const a = x.answer && typeof x.answer === 'object' ? x.answer : null;
    const tag = a !== null && vrStr_(a.label) !== '' ? a.label : (replies.length > 0 ? '返事あり' : '返事なし');
    const when = vrStr_(x.date_label) !== '' ? x.date_label : x.date;
    const verdict = vrStr_(x.verdict) !== '' ? ' ・ 睡眠「' + x.verdict + '」' : '';
    const bubbles = replies.map(function (r) {
      const y = r && typeof r === 'object' ? r : {};
      return '<div class="reply"><div><span>' + vrEsc_(y.text) + '</span><small>' + vrEsc_(y.origin) + ' ' + vrEsc_(y.at) + '</small></div></div>';
    }).join('');
    return '<details><summary><div><div class="dt">' + vrEsc_(when) + '</div><div class="ds">' + vrEsc_(x.time)
      + vrEsc_(verdict) + '</div></div><span class="tag">' + vrEsc_(tag) + '</span></summary><div class="in">'
      + vrParas_(x.body, '') + (vrStr_(x.coda_text) !== '' ? vrParas_(x.coda_text, 'coda') : '') + bubbles + '</div></details>';
  }).join('') + '</div></div>';
}

// 7. 注記(最下部に1回)。
function vrNotes_(model) {
  const m = /(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(typeof model.now === 'string' ? model.now : '');
  return '<div class="notes"><p>平均は28日平均です' + (m ? ' ・ ' + Number(m[2]) + '/' + Number(m[3]) + ' ' + m[4] + ' 時点' : '') + '</p>'
    + vrArr_(model.notes).filter(function (t) { return typeof t === 'string' && t !== ''; }).map(function (t) { return '<p>' + vrEsc_(t) + '</p>'; }).join('')
    + '</div>';
}

// 前回の記録の帯の時刻(材料の now。読めなければ『前回の記録』)。
function vrStaleWhen_(nowText) {
  const m = /^\d{4}-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(typeof nowText === 'string' ? nowText : '');
  if (!m) return VR_TEXT_.stale_prev;
  return Number(m[1]) + '月' + Number(m[2]) + '日 ' + Number(m[3]) + '時' + m[4] + '分の記録';
}

function vrStale_(nowText, view) {
  const when = vrEsc_(vrStaleWhen_(nowText));
  if (view.stale === 'failed') {
    const code = VR_ERROR_CODES_.indexOf(view.code) !== -1 ? view.code : 'error';
    return '<p class="stale" role="status">' + when + 'です。新しい記録を読み込めませんでした(' + code + ')。少し待って開き直してください。</p>';
  }
  return '<p class="stale" role="status">' + when + 'です。新しい記録を読み込んでいます…</p>';
}

function vrClear_() {
  return '<div class="clr"><button type="button" id="clear">' + VR_TEXT_.clear + '</button></div>';
}

function vrCleared_() {
  return '<div class="wrap"><h1>からだの記録</h1><div class="card"><p>' + VR_TEXT_.cleared + '</p></div></div>';
}

// タブの帯(下に固定)。質問のラベルの点(.dot)は app.js が出し入れする。
function vrNav_(tab) {
  return '<nav class="tabs" role="tablist">' + VR_TABS_.map(function (t) {
    return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab ? 'true' : 'false') + '">' + t[1]
      + (t[0] === 'ask' ? '<b class="dot" hidden></b>' : '') + '</button>';
  }).join('') + '</nav>';
}

// 今朝のタブ: 日付 → 今日の一手 → 睡眠 → 今朝の問い → 一手の記録 → 今朝のメッセージ → 目標 → 指標のタイル。
function vrTabToday_(m, noPress) {
  const latest = m.latest && typeof m.latest === 'object' ? m.latest : null;
  const top = latest === null
    ? '<h1>今朝</h1><div class="card"><p>' + VR_TEXT_.empty + '</p></div>'
    : vrDate_(latest, noPress) + vrCoachToday_(m, noPress) + vrSleep_(latest) + vrWake_(latest, noPress) + vrCoachFollowups_(m, noPress) + vrMsg_(latest, noPress);
  return top + vrCoachGoals_(m, noPress) + vrTiles_(latest);
}

// 推移のタブ: 範囲の切り替えを上に1つ → charts[] を順にすべて並べる → 注記。
function vrTabTrend_(m) {
  const charts = vrArr_(m.charts).filter(function (c) { return c && typeof c === 'object' && typeof c.id === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(c.id); });
  if (charts.length === 0) return '<p class="none">' + VR_TEXT_.none + '</p>' + vrNotes_(m);
  const has90 = charts.some(function (c) { return c.d90 && typeof c.d90 === 'object'; });
  return '<div class="tz"><input class="tin ra" type="radio" name="rg" id="rg7"><input class="tin rb" type="radio" name="rg" id="rg28" checked>'
    + (has90 ? '<input class="tin rc" type="radio" name="rg" id="rg90">' : '')
    + '<div class="range"><label class="la" for="rg7">7日</label><label class="lb" for="rg28">28日</label>'
    + (has90 ? '<label class="lc" for="rg90">90日</label>' : '') + '</div><div class="charts">'
    + charts.map(function (c) {
      return '<div class="chart" id="ch-' + c.id + '"><div class="p7">' + vrPanel_(c.d7, '') + '</div><div class="p28">' + vrPanel_(c.d28, '') + '</div>'
        + (has90 ? '<div class="p90">' + vrPanel_(c.d90 && typeof c.d90 === 'object' ? c.d90 : null, '') + '</div>' : '') + '</div>';
    }).join('') + '</div></div>' + vrNotes_(m);
}

// 質問のタブ: 説明(1回だけ)→ 入力欄・写真 → この画面で送ったやり取り → これまでのやり取り(7日。app.js が #ask-hist に差し込む)。
function vrTabAsk_(m, view) {
  if (view && typeof view === 'object' && view.stale === 'loading') return '<p class="hint">' + VR_TEXT_.ask_loading + '</p>';
  if (view && typeof view === 'object' && view.stale === 'failed') return '<p class="hint">' + VR_TEXT_.ask_failed + '</p>';
  const ask = m.ask && typeof m.ask === 'object' ? m.ask : null;
  const latest = m.latest && typeof m.latest === 'object' ? m.latest : null;
  if (ask === null || ask.on !== true || latest === null || typeof latest.push_id !== 'string' || !VR_PUSH_ID_PATTERN_.test(latest.push_id)) {
    return '<p class="hint">' + VR_ASK_TEXT_.off + '</p>';
  }
  return '<p class="hint">' + VR_TEXT_.ask_intro + '</p>' + vrAsk_(latest, ask)
    + '<div class="sec"><h2>' + VR_TEXT_.hist_head + '</h2></div><div id="ask-hist"><p class="hint">' + VR_TEXT_.hist_loading + '</p></div>';
}

// 質問のタブの7日のやり取り(view_page_ask_history の応答 h)。ref(nonce)は HTML に書かない。
function vrAskHistory_(h) {
  if (!h || typeof h !== 'object' || h.ok !== true) return '<p class="hint">' + VR_TEXT_.hist_failed + '</p>';
  if (h.on !== true) return '';
  const w = vrNum_(h.waiting);
  const waiting = w !== null && w >= 1 ? '<p class="hint">画面から送った質問のうち ' + vrEsc_(w) + '件は、お返事を書いています(できたらここか LINE に届きます)。</p>' : '';
  const items = vrArr_(h.items);
  if (items.length === 0) return waiting + '<p class="hint">' + VR_TEXT_.hist_none + '</p>';
  return waiting + items.map(function (it, i) {
    const x = it && typeof it === 'object' ? it : {};
    const a = typeof x.a === 'string' ? x.a : VR_ASK_TEXT_.too_long;
    return '<div class="ask-item past" data-h="' + i + '"><p class="at">' + vrEsc_(x.at) + '</p><p class="ask-q">' + vrEsc_(x.q) + '</p>'
      + '<div class="ans">' + vrEsc_(a) + '</div><p class="ask-st" role="status"></p></div>';
  }).join('');
}

// これまでのタブ: 週の振り返り → 過去7日の朝 → この端末の記録を消す。
function vrTabPast_(m) {
  return vrCoachWeekly_(m) + vrPast_(m.past) + vrClear_();
}

// ページ全体: 4つのタブ(すべて DOM に置き、hidden で切り替える)+ 下の帯。view.tab が4つのどれかならそのタブ、それ以外は今朝。
function vrPage_(model, view) {
  const v = view && typeof view === 'object' ? view : {};
  const stale = v.stale === 'loading' || v.stale === 'failed' ? v : null;
  const noPress = stale !== null;
  const m = model && typeof model === 'object' ? model : {};
  const tab = VR_TABS_.some(function (t) { return t[0] === v.tab; }) ? v.tab : 'today';
  const bodies = {
    today: vrTabToday_(m, noPress),
    trend: vrTabTrend_(m),
    ask: vrTabAsk_(m, stale),
    past: vrTabPast_(m),
  };
  return VR_SPRITE_ + '<div class="wrap">' + (stale ? vrStale_(m.now, stale) : '')
    + VR_TABS_.map(function (t) {
      return '<section class="tab" id="tab-' + t[0] + '" role="tabpanel"' + (t[0] === tab ? '' : ' hidden') + '>' + bodies[t[0]] + '</section>';
    }).join('') + '</div>' + vrNav_(tab);
}

function vrError_(code) {
  const c = VR_ERROR_CODES_.indexOf(code) !== -1 ? code : 'error';
  return '<div class="wrap"><h1>からだの記録</h1><div class="card err"><p>' + (c === 'url' ? VR_TEXT_.url : VR_TEXT_.error)
    + '</p><p class="code">' + c + '</p></div></div>';
}

// line_graph.gs の graphY_ と同じ式(0〜描画の高さの整数。down は上が小さい値)。
function vrY_(v, axis) {
  const H = VR_SVG_PLOT_HEIGHT_;
  const y = axis.down
    ? Math.round(H * (v - axis.lo) / (axis.hi - axis.lo))
    : Math.round(H * (axis.hi - v) / (axis.hi - axis.lo));
  return Math.max(0, Math.min(H, y));
}

// 幅340・描画の高さ150 + 上の余白10・下の日付の行24 の SVG。色は CSS の変数だけ(属性に色を書かない)。
// x = 左 + (i + 0.5) × 描画の幅 / 日数。要素は色ごとの <path> にまとめる(文字数を減らすため)。
function vrSvg_(chart) {
  const c = chart && typeof chart === 'object' ? chart : {};
  const axis = c.axis && typeof c.axis === 'object' ? c.axis : null;
  const dates = vrArr_(c.dates);
  const n = dates.length;
  if (axis === null || n === 0 || vrNum_(axis.lo) === null || vrNum_(axis.hi) === null || !(axis.hi > axis.lo)) return '';
  const W = VR_SVG_WIDTH_;
  const L = VR_SVG_LEFT_;
  const T = VR_SVG_TOP_;
  const PW = W - L - VR_SVG_AXIS_WIDTH_;
  const total = T + VR_SVG_PLOT_HEIGHT_ + VR_SVG_DATE_ROW_;
  const r1 = function (v) { return Math.round(v * 10) / 10; };
  const X = function (i) { return r1(L + (i + 0.5) * PW / n); };
  const Y = function (v) { return T + vrY_(v, axis); };
  const bw = Math.max(2, r1(Math.min(14, PW / n * 0.6)));
  const rt = r1(Math.min(4.5, PW / n * 0.35));
  const right = L + PW;
  const line = function (y) { return '<path d="M' + L + ' ' + y + 'H' + right + '"/>'; };

  const ticks = vrArr_(axis.ticks).filter(function (t) { return t && vrNum_(t.v) !== null; });
  const bars = vrArr_(c.bars).filter(function (b) { return b && vrNum_(b.i) !== null && vrNum_(b.from) !== null && vrNum_(b.to) !== null; });
  const stacks = vrArr_(c.stacks).filter(function (s) {
    return s && vrNum_(s.i) !== null && vrNum_(s.deep) !== null && vrNum_(s.rem) !== null && vrNum_(s.light) !== null;
  });
  const points = vrArr_(c.points).filter(function (p) { return p && vrNum_(p.i) !== null && vrNum_(p.v) !== null; });
  const lastOf = function (list) { return list.reduce(function (m, e) { return Math.max(m, e.i); }, -1); };

  let out = '<svg class="plot" viewBox="0 0 ' + W + ' ' + total + '" role="img" aria-label="' + vrEsc_(c.title) + '">';
  out += '<g class="gr">' + ticks.map(function (t) { return line(Y(t.v)); }).join('') + '</g>';

  if (bars.length > 0) {
    const last = lastOf(bars);
    const d = function (e) {
      const y1 = r1(Y(e.from) + bw / 2);
      return 'M' + X(e.i) + ' ' + y1 + 'V' + Math.max(y1, r1(Y(e.to) - bw / 2));
    };
    const rest = bars.filter(function (e) { return e.i !== last; }).map(d).join('');
    if (rest !== '') out += '<path class="pb f" stroke-width="' + bw + '" d="' + rest + '"/>';
    out += '<path class="pb" stroke-width="' + bw + '" d="' + bars.filter(function (e) { return e.i === last; }).map(d).join('') + '"/>';
  }

  if (stacks.length > 0) {
    const last = lastOf(stacks);
    const rect = function (e, k) {
      const d = e.deep;
      const r = e.rem;
      const y = [Y(0), Y(d), Y(d + r), Y(d + r + e.light)];
      const top = y[k + 1];
      const bottom = y[k];
      return 'M' + r1(X(e.i) - bw / 2) + ' ' + top + 'h' + bw + 'v' + Math.max(1, bottom - top - 1) + 'h-' + bw + 'z';
    };
    [0, 1, 2].forEach(function (k) {
      const rest = stacks.filter(function (e) { return e.i !== last; }).map(function (e) { return rect(e, k); }).join('');
      if (rest !== '') out += '<path class="s' + k + ' f" d="' + rest + '"/>';
      out += '<path class="s' + k + '" d="' + stacks.filter(function (e) { return e.i === last; }).map(function (e) { return rect(e, k); }).join('') + '"/>';
    });
  }

  if (points.length > 0) {
    const last = lastOf(points);
    const rest = points.filter(function (p) { return p.i !== last; }).map(function (p) {
      return '<circle cx="' + X(p.i) + '" cy="' + Y(p.v) + '" r="' + rt + '"/>';
    }).join('');
    if (rest !== '') out += '<g class="pt f">' + rest + '</g>';
    out += points.filter(function (p) { return p.i === last; }).map(function (p) {
      return '<circle class="pt pl" cx="' + X(p.i) + '" cy="' + Y(p.v) + '" r="' + r1(rt + 1.5) + '"/>';
    }).join('');
  }

  const avs = vrArr_(c.avgs).filter(function (a) { return a && vrNum_(a.v) !== null; });
  if (avs.length > 0) out += '<g class="av">' + avs.map(function (a) { return line(Y(a.v)); }).join('') + '</g>';

  out += '<g class="tx">' + ticks.map(function (t) {
    return '<text x="' + (right + 6) + '" y="' + (Y(t.v) + 4) + '">' + vrEsc_(t.text) + '</text>';
  }).join('') + '</g><g class="tx m">';
  const step = Math.max(1, Math.ceil(n / 4));
  for (let j = n - 1; j >= 0; j -= step) {
    out += '<text x="' + X(j) + '" y="' + (total - 6) + '">' + vrEsc_(dates[j]) + '</text>';
  }
  return out + '</g></svg>';
}
