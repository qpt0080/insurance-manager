/* ============================================================
 *  awards-core.js — 시상 해석 공통 모듈 (보험Manager)
 *  ------------------------------------------------------------
 *  목적: 시상(award) 문서를 "상품군 / 지급시기 / 구간·% 금액"으로
 *        해석하는 로직을 한 곳에 모아 모든 화면이 동일하게 쓰게 함.
 *        (awards-compare.html · income-simulator.html · viewer · dashboard · admin)
 *
 *  핵심 집계 분해 — 익월 합계는 항상 세 조각으로:
 *      익월합계 = 수수료 + 기본시상 + 익월시상
 *    · 수수료    = 월납 × 수수료율(예: 522%)            ← "수수료"로 표기
 *    · 기본시상  = type=basic, 익월 지급 (인보험 430% 등)
 *    · 익월시상  = basic 외(가동/추가/연속 등) 익월 지급
 *
 *  window.AwardsCore 로 노출.
 * ============================================================ */
(function () {
  'use strict';

  var BAND_KEYS = [100000, 200000, 300000, 500000];

  /* ── 상품군 분류 ─────────────────────────────────────────────
   *  비(非)인보험만 키워드로 가려냄. 나머지(가동·연속·주력·클럽·멤버십)는
   *  전부 인보험 실적 기반이므로 '인보험'으로 본다.
   *  ※ '가전/금/순금/여행/물품'은 시상 '보상물'이지 상품군이 아니므로 제외하지 않음. */
  function classifyProduct(label) {
    var s = String(label || '');
    if (/펫|반려/.test(s)) return '펫';
    if (/재물|화재/.test(s)) return '재물';
    if (/자동차|운전자|운전면허|운전/.test(s)) return '자동차';
    return '인보험';
  }
  function isInsurance(label) { return classifyProduct(label) === '인보험'; }

  /* ── 기간별 요율 선택 ────────────────────────────────────────
   *  basic tier의 periods 중 (month, day)가 속한 기간의 요율을 반환.
   *  날짜가 없거나 매칭되는 기간이 없으면 첫 기간 요율(없으면 0)로 폴백.
   *  기본시상은 월 내 기간(예: 6.1~14 380% / 6.15~30 320%)이라 같은 달 비교만. */
  function rateOfPeriod(p) {
    if (!p) return 0;
    return (p.totalRate != null ? p.totalRate : (p.ownRate != null ? p.ownRate : 0));
  }
  function periodRate(periods, month, day) {
    periods = periods || [];
    if (!periods.length) return 0;
    if (month != null && day != null) {
      for (var i = 0; i < periods.length; i++) {
        var p = periods[i];
        if (!p || !p.startDate || !p.endDate) continue;
        var s = p.startDate.split('-').map(Number), e = p.endDate.split('-').map(Number);
        if (month === s[0] && month === e[0] && day >= s[1] && day <= e[1]) return rateOfPeriod(p);
      }
    }
    return rateOfPeriod(periods[0]);
  }

  /* ── 지급시기 분류 ───────────────────────────────────────────
   *  '13th' = 13회차 유지, 'tbd' = 미표기(익월로 단정하지 않음), 'next' = 익월 */
  function classifyTiming(tier) {
    if (!tier) return 'next';
    if (tier.payTiming === '13th_payment' || tier.retention === 13) return '13th';
    if (tier.payTiming == null) return 'tbd';   // null·undefined(미표기) 모두 tbd — 익월로 단정하지 않음
    return 'next';
  }

  function man(n) { return Math.round((+n || 0) / 10000); }

  /* ── 구간(band) 금액 계산 ───────────────────────────────────── */
  // 단일 threshold형(weekly/flagship/club/membership): 빈 구간은 직전 금액 이월
  function bandsFromTiers(arr) {
    var raw = { 100000: 0, 200000: 0, 300000: 0, 500000: 0 };
    (arr || []).forEach(function (t) {
      var th = (t.threshold != null) ? +t.threshold : null;
      if (th != null && raw[th] !== undefined && (+t.reward) > 0) raw[th] = Math.max(raw[th], +t.reward);
    });
    var carry = 0, bands = {};
    BAND_KEYS.forEach(function (b) { if (raw[b] > 0) carry = raw[b]; bands[b] = carry; });
    return bands;
  }
  // 연속가동형(prev/curr 둘 다 충족해야 자격): 자격 구간 중 최대 보상
  function bandsFromConsecutive(arr) {
    var bands = { 100000: 0, 200000: 0, 300000: 0, 500000: 0 };
    BAND_KEYS.forEach(function (B) {
      var best = 0;
      (arr || []).forEach(function (t) {
        var pv = +(t.prevThreshold != null ? t.prevThreshold : (t.threshold || 0));
        var cv = +(t.currThreshold != null ? t.currThreshold : (t.threshold || 0));
        var rw = +(t.reward || 0);
        if (rw > 0 && pv <= B && cv <= B) best = Math.max(best, rw);
      });
      bands[B] = best;
    });
    return bands;
  }
  function bandsAllZero(b) { return BAND_KEYS.every(function (k) { return !b[k]; }); }

  // 사람이 읽는 구간 요약 (예: "10만→20만 · 20만→40만")
  function bandSub(b) {
    var out = [], last = null;
    for (var i = 0; i < BAND_KEYS.length; i++) {
      var k = BAND_KEYS[i];
      if (b[k] > 0 && b[k] !== last) { out.push(man(k) + '만→' + man(b[k]) + '만'); last = b[k]; }
    }
    return out.join(' · ');
  }
  function bandPairs(b) {
    var out = [], last = null;
    for (var i = 0; i < BAND_KEYS.length; i++) {
      var k = BAND_KEYS[i];
      if (b[k] > 0 && b[k] !== last) { out.push([k, b[k]]); last = b[k]; }
    }
    return out;
  }

  function matchBand(perf) {
    var p = +perf || 0, hit = 0;
    BAND_KEYS.forEach(function (b) { if (p >= b) hit = b; });
    return hit || null;
  }

  /* ── 시상 문서 → 정규화 항목 목록 ────────────────────────────
   *  각 항목: { id,label,type,product,timing,kind,mode,rate?,bands?,sub,on,audienceGroup,eligibility,special } */
  function itemsFromDoc(doc) {
    var out = [];
    (doc && doc.tiers || []).forEach(function (t, i) {
      var timing = classifyTiming(t);
      var product = classifyProduct(t.label);
      var ag = t.audienceGroup || null, el = t.eligibility || null;
      var base = { timing: timing, product: product, on: true, audienceGroup: ag, eligibility: el };

      if (t.type === 'basic') {
        var rate = periodRate(t.periods, null, null); // 단일 시뮬: 첫 기간(최대 요율). 실적 화면은 계약일로 periodRate 직접 호출
        out.push(Object.assign({ id: t.id || ('b' + i), label: t.label || '기본시상', type: 'basic',
          kind: '기본시상', mode: 'rate', rate: rate, sub: rate + '%' }, base));
      } else if (t.type === 'special') {
        var sr = +(t.rate || 0); if (!sr) return;
        out.push(Object.assign({ id: t.id || ('s' + i), label: t.label || '특별시상', type: 'special',
          kind: '익월시상', mode: 'rate', rate: sr, sub: sr + '%', special: true }, base));
      } else if (t.type === 'consecutive') {
        var cb = bandsFromConsecutive(t.tiers); if (bandsAllZero(cb)) return;
        out.push(Object.assign({ id: t.id || ('c' + i), label: t.label || '연속가동', type: 'consecutive',
          kind: '익월시상', mode: 'band', bands: cb, rate: 0, sub: bandSub(cb) }, base));
      } else if (['weekly', 'weekly_extra', 'flagship', 'club', 'membership'].indexOf(t.type) !== -1) {
        var wb = bandsFromTiers(t.tiers); if (bandsAllZero(wb)) return;
        out.push(Object.assign({ id: t.id || ('w' + i), label: t.label || t.type, type: t.type,
          kind: '익월시상', mode: 'band', bands: wb, rate: 0, sub: bandSub(wb) }, base));
      }
      // gift/travel(현금 아님)은 합계 제외 → extrasFromDoc에서 별도 표시
    });
    return out;
  }

  function extrasFromDoc(doc) {
    var ex = [];
    (doc && doc.tiers || []).forEach(function (t) {
      if (t.type === 'gift' && t.gift) ex.push('🎁 ' + t.gift);
      else if (t.type === 'travel' && (t.travel || t.gift)) ex.push('✈️ ' + (t.travel || t.gift));
    });
    return ex;
  }

  /* ── 집계 ────────────────────────────────────────────────────
   *  items, perf, opts{ product:'인보험'|'전체', commRate, keepRate,
   *                      keepFrom, keepTo, inAudience, meetsEligibility }
   *  반환: { 수수료, 기본시상, 익월시상, 익월합계,
   *          r13, tbd, keepTotal, keepEach, keepN, 총액, band, detail[] } */
  function aggregate(items, perf, opts) {
    opts = opts || {};
    var P = +perf || 0;
    var band = matchBand(P);
    var insOnly = (opts.product === '인보험');
    var commRate = +opts.commRate || 0, keepRate = +opts.keepRate || 0;
    var keepFrom = opts.keepFrom != null ? opts.keepFrom : 7;
    var keepTo = opts.keepTo != null ? opts.keepTo : 15;
    var inAudience = opts.inAudience || function () { return true; };
    var meetsEligibility = opts.meetsEligibility || function () { return true; };

    var 수수료 = P * commRate / 100;
    var 기본시상 = 0, 익월시상 = 0, r13 = 0, tbd = 0;
    var detail = [{ label: '수수료', sub: commRate + '%', kind: '수수료', timing: 'next',
                    amount: 수수료, on: true }];

    (items || []).forEach(function (it) {
      if (insOnly && it.product !== '인보험') return;        // 인보험 필터
      if (!inAudience(it.audienceGroup)) return;             // 그룹 한정
      if (!meetsEligibility(it.eligibility)) return;          // 자격 판정
      var v = 0;
      if (it.on) v = it.mode === 'rate' ? P * (it.rate || 0) / 100 : (band ? (it.bands[band] || 0) : 0);

      if (it.timing === '13th') r13 += v;
      else if (it.timing === 'tbd') tbd += v;
      else if (it.kind === '기본시상') 기본시상 += v;
      else 익월시상 += v;

      detail.push({ label: it.label, sub: it.sub, kind: it.kind, timing: it.timing,
                    product: it.product, amount: v, on: it.on, special: !!it.special });
    });

    var 익월합계 = 수수료 + 기본시상 + 익월시상;
    var keepTotal = P * keepRate / 100;
    var keepN = keepTo - keepFrom + 1;
    var keepEach = keepN ? keepTotal / keepN : 0;
    var 총액 = 익월합계 + r13 + tbd + keepTotal;

    return { 수수료: 수수료, 기본시상: 기본시상, 익월시상: 익월시상, 익월합계: 익월합계,
             r13: r13, tbd: tbd, keepTotal: keepTotal, keepEach: keepEach, keepN: keepN,
             총액: 총액, band: band, commRate: commRate, keepRate: keepRate, detail: detail };
  }

  /* ── 계약일 파싱 / 주차 기간 매칭 (전 페이지 공용 단일 원본) ──────
   *  날짜 소스: ct.startDate → rawJson.계약일 (uploadedAt은 업로드시점이라 계약일로 쓰지 않음)
   *  parsePeriod: {year, month, day|null} | null
   *  inWeeklyPeriod: 계약일이 주차 시상 기간(MM-DD~MM-DD) 안에 드는지 */
  function ctDate(ct) {
    return (ct && (ct.startDate || (ct.rawJson && ct.rawJson['계약일']))) || '';
  }
  function parsePeriod(ct) {
    var d = String(ctDate(ct));
    var m = d.match(/(\d{4})[.\-\/](\d{1,2})(?:[.\-\/](\d{1,2}))?/);
    if (m) return { year: +m[1], month: +m[2], day: m[3] ? +m[3] : null };
    var y = d.match(/(\d{4})/);
    return y ? { year: +y[1], month: null, day: null } : null;
  }
  // 계약 배열 중 가장 늦은 계약월 "YYYY-MM" (없으면 null) — 대시보드 최근계약 윈도우용
  function ymOfContracts(contracts) {
    var max = null;
    (contracts || []).forEach(function (ct) {
      var p = parsePeriod(ct);
      if (p && p.year && p.month) {
        var ym = p.year + '-' + String(p.month).padStart(2, '0');
        if (!max || ym > max) max = ym;
      }
    });
    return max;
  }
  function inWeeklyPeriod(ct, period, ay, am) {
    if (!period || !period.startDate || !period.endDate) return true; // 기간 없으면 전체 허용
    var fd = parsePeriod(ct);
    if (!fd || fd.day == null) return false;                          // 일자 모르면 매칭 불가(안전하게 제외)
    if (fd.year !== ay || fd.month !== am) return false;
    var s = period.startDate.split('-').map(Number);
    var e = period.endDate.split('-').map(Number);
    if (fd.month === s[0] && fd.month === e[0]) return fd.day >= s[1] && fd.day <= e[1]; // 같은 달 주차
    return false;
  }

  window.AwardsCore = {
    BAND_KEYS: BAND_KEYS,
    parsePeriod: parsePeriod,
    inWeeklyPeriod: inWeeklyPeriod,
    ymOfContracts: ymOfContracts,
    classifyProduct: classifyProduct,
    isInsurance: isInsurance,
    periodRate: periodRate,
    classifyTiming: classifyTiming,
    bandsFromTiers: bandsFromTiers,
    bandsFromConsecutive: bandsFromConsecutive,
    bandsAllZero: bandsAllZero,
    bandSub: bandSub,
    bandPairs: bandPairs,
    matchBand: matchBand,
    itemsFromDoc: itemsFromDoc,
    extrasFromDoc: extrasFromDoc,
    aggregate: aggregate,
    man: man
  };
})();
