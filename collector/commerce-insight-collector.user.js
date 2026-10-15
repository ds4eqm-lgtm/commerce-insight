// ==UserScript==
// @name         커머스 인사이트 수집기
// @namespace    commerce-insight
// @version      5.0.0
// @description  커머스 인사이트: 상품페이지가 스스로 불러오는 옵션별 재고를 읽어 깃허브(ds4eqm-lgtm/commerce-insight)에 기록
// @match        https://smartstore.naver.com/*/products/*
// @match        https://brand.naver.com/*/products/*
// @match        https://ds4eqm-lgtm.github.io/commerce-insight/*
// @grant        GM_xmlhttpRequest
// @grant        window.close
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @connect      api.github.com
// @run-at       document-start
// @updateURL    none
// @downloadURL  none
// ==/UserScript==

// 4.x 대비 바뀐 점
// 1. 재고 리셋 감지: 한 번에 100개 이상 줄면서 10,000·99,999 처럼 딱 떨어지는 수가 되면 판매가 아니라 '수동변경 의심'으로 분리
//    (엑셀 '99999로 리셋할 경우 집계 하루 미룸' 규칙. 1,000개 이상 한 번에 주는 기존 규칙도 그대로)
// 2. 토큰을 어떤 화면에도 넘기지 않음 (대시보드는 토큰 없이 읽기만 함)
// 3. 매시 정리(#flush) 때 data/status.json 에 수집 결과(몇 개 성공, 빠진 상품) 기록
// 4. 토큰이 비어 있으면 올리지 않고 결과를 보관해 둠 (다음 정각에 다시 올림)
// 기록 형식(data/history.json, data/latest.json)은 4.x 와 같음

(function () {
  'use strict';

  // ---------------- 토큰은 여기 따옴표 안에만 넣기 (다른 곳에 붙여넣지 말 것) ----------------
  const GITHUB_TOKEN = "";
  // -------------------------------------------------------------------------------------------
  const GITHUB_OWNER = 'ds4eqm-lgtm';
  const GITHUB_REPO = 'commerce-insight';
  const VERSION = '5.0.0';

  const DAY_START_HOUR = 7;  // 하루 시작 (07:00 ~ 다음날 07:00)
  const SPLIT_HOUR = 17;     // 2타임(07~17) / 1타임(17~다음날 07) 나누는 시각
  const LONG_GAP_HOURS = 16; // 기록 사이가 이보다 길게 비면 기간불명으로 따로 표시
  const HISTORY_KEEP_DAYS = 14; // 시간별 기록 보관 기간 (일별 판매량은 latest.json에 영구 보관)
  const STATUS_KEEP = 72;    // status.json 에 남길 최근 수집 결과 개수

  const isDashboard = window.location.hostname === `${GITHUB_OWNER}.github.io` && window.location.pathname.startsWith(`/${GITHUB_REPO}/`);
  const urlMatch = window.location.pathname.match(/^\/([^/]+)\/products\/(\d+)/);
  if (!urlMatch && !isDashboard) return;
  const storeSlug = urlMatch ? urlMatch[1] : '';
  const productNo = urlMatch ? urlMatch[2] : '';
  const API_PATTERN = new RegExp(`/v2/channels/([^/]+)/products/${productNo}`);
  const LOG = '[커머스인사이트]';

  let handled = false;   // 재고 데이터를 받아서 처리 시작했는지
  let finished = false;  // 업로드까지 끝났는지

  // ---------------- 자동조회로 열린 탭이면 작업 끝나고 탭 닫기 ----------------
  // 자동조회 bat이 주소 끝에 #autotrack 을 붙여서 연다. 직접 연 탭은 절대 안 닫음
  let autoMode = false;
  try {
    if (window.location.hash === '#autotrack') sessionStorage.setItem('autotrack', '1');
    autoMode = sessionStorage.getItem('autotrack') === '1';
  } catch (e) {
    autoMode = window.location.hash === '#autotrack';
  }

  function closeAutoTab() {
    if (!autoMode) return;
    try { sessionStorage.removeItem('autotrack'); } catch (e) { /* 무시 */ }
    setTimeout(() => window.close(), 1500);
  }

  if (autoMode) {
    // 60초가 지나도 재고 데이터를 못 받으면 한 번만 새로고침해서 재시도
    setTimeout(() => {
      if (handled) return;
      let retried = false;
      try { retried = sessionStorage.getItem('autotrack_retry') === '1'; } catch (e) { /* 무시 */ }
      if (!retried) {
        console.log(`${LOG} 60초 동안 데이터 없음, 새로고침 재시도`);
        try { sessionStorage.setItem('autotrack_retry', '1'); } catch (e) { /* 무시 */ }
        window.location.reload();
      } else {
        console.log(`${LOG} 재시도해도 데이터 없음, 탭 닫기`);
        closeAutoTab();
      }
    }, 60000);
    // 혹시 멈춰도 3분 뒤에는 닫기
    setTimeout(() => { if (!finished) closeAutoTab(); }, 180000);
  }

  // ---------------- 날짜 계산 ----------------
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function toDate(key) {
    const [d, t = '00:00'] = key.split('T');
    const [y, m, day] = d.split('-').map(Number);
    const [hh, mm] = t.split(':').map(Number);
    return new Date(y, m - 1, day, hh || 0, mm || 0);
  }

  // 하루 = 그날 07:00 ~ 다음날 07:00 / 2타임 = 07:00 ~ 17:00, 1타임 = 17:00 ~ 다음날 07:00
  function bizDayOf(dt) {
    const d = new Date(dt);
    if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
    return ymd(d);
  }

  function dayWindow(day) {
    const start = toDate(day);
    start.setHours(DAY_START_HOUR, 0, 0, 0);
    const split = new Date(start);
    split.setHours(SPLIT_HOUR, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, split, end };
  }

  // ---------------- 수동 재고변경 감지 (commerce05.html, index.html 과 값을 똑같이 맞출 것) ----------------
  const DETECT = {
    BIG_DROP: 1000,       // 한 번에 이 수량 이상 줄면 사람이 재고를 직접 고친 것으로 의심
    BIG_RISE: 1000,       // 한 번에 이 수량 이상 늘면 '재고 대량 증가'로 표시 (판매량에는 영향 없음)
    RESET_MIN_DROP: 100,  // 이 수량 이상 줄면서 딱 떨어지는 수(리셋값)가 되면 재고 리셋으로 의심
  };
  // 리셋값: 1,000 이상이면서 1,000 단위로 딱 떨어지거나(10,000 등) 9로만 된 수(9,999 · 99,999 등)
  const isResetValue = (v) => v >= 1000 && (v % 1000 === 0 || /^9{4,}$/.test(String(v)));

  function detectSuspicious(history) {
    const out = {};
    Object.keys(history).forEach((key) => {
      const rec = history[key] || {};
      const ts = Object.keys(rec).sort();
      for (let i = 1; i < ts.length; i++) {
        const a = rec[ts[i - 1]], b = rec[ts[i]], d = a - b;
        let why = null;
        if (d >= DETECT.BIG_DROP) why = `${a.toLocaleString()}개에서 ${b.toLocaleString()}개로 한 번에 ${d.toLocaleString()}개 줄어듦 (${DETECT.BIG_DROP.toLocaleString()}개 이상)`;
        else if (d >= DETECT.RESET_MIN_DROP && isResetValue(b)) why = `${a.toLocaleString()}개에서 ${b.toLocaleString()}개로 맞춰짐 (재고 리셋 의심)`;
        if (why) (out[key] = out[key] || {})[ts[i]] = { d, why: [why] };
      }
    });
    return out;
  }

  // 하루 판매량 계산
  // s: 판매 / u: 기록이 너무 오래 비어 언제 팔렸는지 모르는 양 / x, ev: 수동변경 의심 / k: 그날 마지막 재고
  function computeDay(rec, day, flags, now) {
    flags = flags || {};
    const { start, split, end } = dayWindow(day);
    const es = Object.keys(rec).map((t) => ({ t, dt: toDate(t), v: rec[t] })).sort((a, b) => a.dt - b.dt);
    const mk = () => ({ s: 0, u: 0, x: 0, ev: [], up: 0, upEv: [], uEv: [] });
    const all = mk();
    const t1 = mk();
    const t2 = mk();
    let k = null;
    let any = false;
    let base = false;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.dt < start) { base = true; continue; }
      if (e.dt >= end || (now && e.dt > now)) break;
      any = true;
      k = e.v;
      const nx = es[i + 1];
      if (!nx || (now && nx.dt > now)) continue;
      const d = e.v - nx.v;
      const per = e.dt < split ? t2 : t1;
      if (d < 0) {
        if (-d >= DETECT.BIG_RISE) [per, all].forEach((p) => { p.up += -d; p.upEv.push([nx.t, -d, e.v, nx.v]); });
        continue;
      }
      if (d === 0) continue;
      const f = flags[nx.t];
      const gapH = (nx.dt - e.dt) / 3600000;
      [per, all].forEach((p) => {
        if (f) { p.x += d; p.ev.push([nx.t, d, f.why.join(', ')]); }
        else if (gapH > LONG_GAP_HOURS) { p.u += d; p.uEv.push([e.t, nx.t, d]); }
        else p.s += d;
      });
    }
    if (!any) return null;
    return Object.assign(all, { k, base, t1, t2 });
  }

  // 마감이 끝난 날들의 일별 판매량 계산
  function computeFinishedDays(rec, now, flags) {
    const keys = Object.keys(rec).sort();
    if (!keys.length) return {};
    const out = {};
    const today = bizDayOf(now);
    const d = toDate(bizDayOf(toDate(keys[0])));
    for (let guard = 0; guard < 400; guard++) {
      const day = ymd(d);
      if (day >= today) break;
      const r = computeDay(rec, day, flags, now);
      if (r) out[day] = r;
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  // ---------------- 재고 데이터 읽기 ----------------
  function extractOptions(data) {
    const results = [];
    const list = data.optionCombinations || data.standardCombinations || [];
    list.forEach((o) => {
      if (o.stockQuantity != null) {
        const parts = Object.keys(o)
          .filter((k) => /^optionName\d+$/.test(k))
          .sort()
          .map((k) => o[k])
          .filter(Boolean);
        const name = parts.length ? parts.join(' / ') : String(o.id);
        results.push({ id: String(o.id), name, stock: o.stockQuantity });
      }
    });
    if (!results.length) {
      (data.simpleOptions || []).forEach((o) => {
        if (o.stockQuantity != null) {
          results.push({ id: String(o.id || o.optionName1 || 'default'), name: o.optionName1 || o.name || '기본옵션', stock: o.stockQuantity });
        }
      });
    }
    if (!results.length && data.stockQuantity != null) {
      results.push({ id: 'default', name: '기본', stock: data.stockQuantity });
    }
    return results;
  }
  function extractProductName(data) { return data.name || data.productName || document.title || `상품 ${productNo}`; }
  function extractStoreName(data) { return (data.channel && data.channel.channelName) || storeSlug; }

  // ---------------- 깃허브 읽기/쓰기 (토큰은 이 함수 안에서만 씀) ----------------
  function ghRequest(method, path, body, accept) {
    const bust = method === 'GET' ? `?t=${Date.now()}${Math.random().toString(36).slice(2, 6)}` : '';
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}${bust}`,
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: accept || 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        nocache: true,
        data: body ? JSON.stringify(body) : undefined,
        timeout: 180000,
        onload: (res) => resolve(res),
        onerror: (err) => reject(err),
        ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  async function getTextFile(path) {
    const res = await ghRequest('GET', path);
    if (res.status === 200) {
      const json = JSON.parse(res.responseText);
      if (json.encoding === 'base64' && json.content) return { text: decodeURIComponent(escape(atob(json.content.replace(/\n/g, '')))), sha: json.sha };
      // 1MB 넘는 파일은 content 가 비어서 오므로 원본으로 다시 받기
      const raw = await ghRequest('GET', path, null, 'application/vnd.github.raw+json');
      if (raw.status !== 200) throw new Error(`GET raw ${path} 실패 status ${raw.status}`);
      return { text: raw.responseText, sha: json.sha };
    }
    if (res.status === 404) return { text: null, sha: null };
    const err = new Error(`GET ${path} 실패 status ${res.status}`);
    err.status = res.status;
    throw err;
  }
  async function getJsonFile(path) {
    const { text, sha } = await getTextFile(path);
    return { content: text ? JSON.parse(text) : {}, sha };
  }

  function encodeContent(obj) { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }

  // 일별 보관값에서 0이나 빈 목록은 빼고 저장 (latest.json 크기 줄이기)
  function compactDay(r) {
    const out = {};
    ['s', 'u', 'k', 'x', 'up'].forEach((f) => { if (r[f]) out[f] = r[f]; });
    if (r.k === 0) out.k = 0;
    if (r.ev && r.ev.length) out.ev = r.ev;
    if (r.upEv && r.upEv.length) out.upEv = r.upEv;
    if (r.t1) out.t1 = compactDay(r.t1);
    if (r.t2) out.t2 = compactDay(r.t2);
    return out;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 여러 탭이 동시에 같은 파일을 고치면 충돌이 나므로 성공할 때까지 다시 읽고 다시 씀
  async function updateJsonFile(path, mutateFn, message) {
    if (!GITHUB_TOKEN) throw new Error('토큰이 비어 있음 (스크립트의 GITHUB_TOKEN 따옴표 안에 넣어 주세요)');
    const MAX_ATTEMPTS = 20;
    let lastError = '';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const { content, sha } = await getJsonFile(path);
        const updated = mutateFn(content);
        const res = await ghRequest('PUT', path, { message, content: encodeContent(updated), sha: sha || undefined });
        if (res.status === 200 || res.status === 201) return;
        lastError = `status ${res.status} ${String(res.responseText).slice(0, 200)}`;
        if (res.status === 401 || res.status === 403) throw new Error(`PUT ${path} 권한 오류 ${lastError}`);
      } catch (e) {
        if (String(e.message || '').includes('권한 오류')) throw e;
        if (e.status === 401 || e.status === 403) throw e;
        lastError = e.message || String(e);
      }
      console.log(`${LOG} ${path} 저장 재시도 ${attempt + 1} (${lastError})`);
      await sleep(Math.min(6000, 500 * 2 ** attempt) + Math.random() * 1500);
    }
    throw new Error(`PUT ${path} 재시도 초과 (${lastError})`);
  }

  // ---------------- 여러 상품을 한 번에 깃허브에 올리기 ----------------
  // entry = { channelId, productNo, storeName, productName, nowKey, today, options: [{id, name, stock}] }
  async function uploadEntries(entries) {
    if (!entries.length) return;
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - HISTORY_KEEP_DAYS);
    const cutoffStr = ymd(cutoff);
    const dailyMap = {};
    const keyOf = (en, opt) => `${en.channelId}_${en.productNo}_${opt.id}`;
    const label = entries.length === 1 ? entries[0].storeName : `${entries.length}개 상품`;
    const stamp = entries[0].nowKey;

    await updateJsonFile('data/history.json', (history) => {
      entries.forEach((en) => en.options.forEach((opt) => {
        const key = keyOf(en, opt);
        const rec = history[key] || {};
        rec[en.nowKey] = opt.stock;
        history[key] = rec;
      }));
      const flags = detectSuspicious(history);
      entries.forEach((en) => en.options.forEach((opt) => {
        const key = keyOf(en, opt);
        const rec = history[key];
        // 오래된 기록을 지우기 전에 일별 판매량부터 계산해 둠
        dailyMap[key] = computeFinishedDays(rec, now, flags[key] || {});
        Object.keys(rec).forEach((t) => { if (t < cutoffStr) delete rec[t]; });
      }));
      return history;
    }, `판매량 업데이트 ${label} ${stamp}`);

    await updateJsonFile('data/latest.json', (latest) => {
      entries.forEach((en) => en.options.forEach((opt) => {
        const key = keyOf(en, opt);
        const old = latest[key] || {};
        const daily = Object.assign({}, old.daily || {});
        Object.entries(dailyMap[key] || {}).forEach(([day, r]) => {
          // 기준 기록이 남아 있는 날은 새로 계산한 값으로, 아니면 기존 보관값 유지
          if (r.base || !daily[day] || !daily[day].t1) daily[day] = compactDay(r);
        });
        latest[key] = { store: en.storeName, product: en.productNo, productName: en.productName, optionName: opt.name, date: en.today, stock: opt.stock, daily };
      }));
      return latest;
    }, `판매량 업데이트 ${label} ${stamp.slice(0, 10)}`);
  }

  // 매시 수집 결과를 data/status.json 에 남김 (화면의 '수집 상태'가 읽음)
  async function writeStatus(entries, ok, error) {
    let listed = [];
    try {
      const { text } = await getTextFile('products.txt');
      listed = [...new Set(((text || '').match(/^\s*https?:\/\/\S+\/products\/(\d+)/gm) || []).map((l) => l.match(/products\/(\d+)/)[1]))];
    } catch (e) { /* 목록을 못 읽어도 결과는 남김 */ }
    const got = [...new Set(entries.map((en) => String(en.productNo)))];
    const now = new Date();
    const run = {
      time: `${ymd(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`,
      hour: entries[0] ? entries[0].nowKey : null,
      collector: VERSION,
      listed: listed.length,
      collected: got.length,
      missing: listed.filter((p) => !got.includes(p)),
      uploaded: ok,
      error: error || '',
    };
    await updateJsonFile('data/status.json', (st) => {
      const runs = [run].concat(Array.isArray(st.runs) ? st.runs : []).slice(0, STATUS_KEEP);
      return { last: run, runs };
    }, `수집 상태 ${run.time} ${run.collected}/${run.listed}`);
  }

  // ---------------- 상품 페이지 처리 ----------------
  async function handleStockData(channelId, data) {
    if (handled) return;
    const options = extractOptions(data);
    if (!options.length) { console.log(`${LOG} 옵션 정보를 찾지 못함`); return; }
    handled = true;
    try { sessionStorage.removeItem('autotrack_retry'); } catch (e) { /* 무시 */ }
    if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r));

    const now = new Date();
    const today = ymd(now);
    const entry = { channelId, productNo, storeName: extractStoreName(data), productName: extractProductName(data), nowKey: `${today}T${pad(now.getHours())}:00`, today, options };

    if (autoMode) {
      // 자동조회 탭: 탬퍼몽키 저장소에만 넣고 바로 닫음 → 정리용 페이지(#flush)가 한꺼번에 올림
      GM_setValue(`pending_${productNo}_${entry.nowKey}`, entry);
      console.log(`${LOG} ${entry.storeName} 대기열에 넣음 - 옵션 ${options.length}개`);
      finished = true;
      closeAutoTab();
      return;
    }
    // 직접 연 탭은 바로 올림
    try {
      await uploadEntries([entry]);
      console.log(`${LOG} ${entry.storeName} / ${entry.productName} 완료 - 옵션 ${options.length}개`);
    } catch (e) {
      console.log(`${LOG} 깃허브 업로드 실패`, e);
    }
    finished = true;
  }

  // ---------------- 정리용 페이지: 대기열에 쌓인 상품을 한꺼번에 올림 ----------------
  const pendingKeys = () => GM_listValues().filter((k) => k.startsWith('pending_'));

  async function flushPending() {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;background:#111;color:#fff;padding:12px 16px;border-radius:8px;font:14px sans-serif;max-width:420px';
    const say = (t) => { box.textContent = `${LOG} ` + t; console.log(`${LOG} ` + t); };
    if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r));
    if (document.body) document.body.appendChild(box);

    // 늦게 끝난 탭도 기다림: 20초 동안 새로 들어온 게 없으면 시작 (최대 4분)
    let last = -1;
    let stableSince = Date.now();
    const startAt = Date.now();
    while (Date.now() - startAt < 240000) {
      const n = pendingKeys().length;
      if (n !== last) { last = n; stableSince = Date.now(); }
      say(`조회 결과 모으는 중... ${n}개 상품`);
      if (Date.now() - stableSince > 20000) break;
      await sleep(2000);
    }

    const keys = pendingKeys();
    const entries = keys.map((k) => GM_getValue(k)).filter(Boolean);
    if (!GITHUB_TOKEN) {
      box.style.background = '#b91c1c';
      say(`토큰이 비어 있어 올리지 못했습니다. 결과 ${entries.length}개는 보관해 두고 다음 정각에 다시 올립니다. 탬퍼몽키에서 이 스크립트의 GITHUB_TOKEN 따옴표 안에 토큰을 넣어 주세요.`);
      setTimeout(() => window.close(), 600000);
      return;
    }
    if (!entries.length) {
      say('올릴 결과 없음');
      try { await writeStatus([], false, '올릴 결과 없음'); } catch (e) { /* 무시 */ }
      setTimeout(() => window.close(), 5000);
      return;
    }
    say(`${entries.length}개 상품을 깃허브에 올리는 중...`);
    let ok = false;
    let lastErr = '';
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        await uploadEntries(entries);
        ok = true;
      } catch (e) {
        lastErr = (e && e.message) || String(e);
        say(`업로드 실패 ${attempt}/3: ${lastErr}`);
        if (attempt < 3) await sleep(30000);
      }
    }
    try { await writeStatus(entries, ok, ok ? '' : lastErr); } catch (e) { console.log(`${LOG} 수집 상태 기록 실패`, e); }
    if (ok) {
      keys.forEach((k) => GM_deleteValue(k));
      say(`${entries.length}개 상품 업로드 완료`);
      setTimeout(() => window.close(), 5000);
    } else {
      // 실패하면 결과는 지우지 않고 남겨둠 → 다음 정각 조회 때 같이 올라감
      box.style.background = '#b91c1c';
      say('업로드 실패. 결과는 보관해 두었다가 다음 조회 때 다시 올립니다. 이 화면을 캡처해 두세요.');
      setTimeout(() => window.close(), 600000);
    }
  }

  if (isDashboard) {
    // 대시보드 쪽에서는 #flush 일 때 업로드만 함. 토큰이나 저장 기능은 화면에 넘기지 않음
    if (window.location.hash === '#flush') flushPending();
    return;
  }

  // ---------------- 상품 페이지: 페이지가 스스로 부르는 재고 응답을 읽음 ----------------
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const req = args[0];
    const url = typeof req === 'string' ? req : req && req.url;
    const promise = originalFetch.apply(this, args);
    if (url && API_PATTERN.test(url)) {
      promise
        .then((res) => res.clone().json())
        .then((data) => { const m = url.match(API_PATTERN); handleStockData(m[1], data); })
        .catch(() => {});
    }
    return promise;
  };

  const OrigXHR = window.XMLHttpRequest;
  const origOpen = OrigXHR.prototype.open;
  const origSend = OrigXHR.prototype.send;
  OrigXHR.prototype.open = function (method, url, ...rest) {
    this._trackedUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  OrigXHR.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      if (this._trackedUrl && API_PATTERN.test(this._trackedUrl)) {
        try {
          const data = JSON.parse(this.responseText);
          const m = this._trackedUrl.match(API_PATTERN);
          handleStockData(m[1], data);
        } catch (e) { /* 무시 */ }
      }
    });
    return origSend.apply(this, args);
  };
})();
