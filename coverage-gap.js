/* 무진 보장 분석 엔진  (coverage-gap.js)
 * ─────────────────────────────────────────────────────────
 * 한 고객의 "보장 합산"(coverage-summary.js / window.CovAgg) 결과를
 * 운영자가 정한 권장 기준(STANDARDS)과 비교해서
 *   · 공백 : 핵심 보장인데 아예 없음
 *   · 부족 : 있긴 한데 권장 금액에 못 미침
 *   · 과다 : 같은 보장이 여러 건이고 합계가 권장의 상한을 크게 넘음(중복 점검)
 *   · 적정 : 권장 이상
 * 으로 판정하고, 우선순위가 높은 순서로 "보강·정리 제안"을 보여준다.
 *
 * ※ 이 파일은 합산을 다시 하지 않는다. CovAgg.summarize()의 결과 위에
 *   "기준 비교" 한 겹만 얹는 얇은 레이어다. (담보 파싱·분류는 CovAgg가 담당)
 *
 * ⚠️ STANDARDS(권장 기준)는 아래에서 자유롭게 수정/추가하세요.
 *    - key 는 coverage-summary.js의 CATS.key 와 1:1로 맞춰야 합니다.
 *    - 금액은 "원" 단위. (5,000만원 = 50000000)
 *    - 이 수치는 약관상 정답이 아니라 "운영자가 정한 일반 가이드"입니다.
 * ───────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  /* ── 권장 기준표 (운영자 편집 영역) ──────────────────────────
   *  essential   : true면 없을 때 최우선 경보(필수 보장)
   *  min         : 권장 최소 보장금액(원). 일시금 합계와 비교.
   *  dupAt       : 이 금액을 "여러 건 합산"으로 초과하면 중복/과다로 점검 제안.
   *  presenceOnly: 금액 비교가 부적합한 보장(실손·간병 등)은 '가입 여부'만 본다.
   * ─────────────────────────────────────────────────────────── */
  var STANDARDS = {
    cancer:     { label: '암 진단',    essential: true,  min:  50000000, dupAt: 150000000 },
    brain:      { label: '뇌혈관',     essential: true,  min:  20000000, dupAt:  60000000 },
    heart:      { label: '심장질환',   essential: true,  min:  20000000, dupAt:  60000000 },
    surgery:    { label: '수술',       essential: false, presenceOnly: true },
    disability: { label: '후유장해',   essential: false, min:  50000000 },
    death:      { label: '사망',       essential: false, min:  30000000, dupAt: 300000000 },
    care:       { label: '간병·치매',  essential: false, presenceOnly: true }
    // 필요하면 fracture / driver / liability / dental 등을 같은 형식으로 추가하세요.
  };

  function won0(g) { return g ? (g.lumpWon || 0) : 0; }

  function iconFor(key, fallbackLabel) {
    var cats = (global.CovAgg && global.CovAgg.CATS) || [];
    for (var i = 0; i < cats.length; i++) if (cats[i].key === key) return cats[i].icon;
    return '•';
  }

  /* ── 핵심: 고객 → 판정 결과 ──────────────────────────────────
   *  반환: { results:[...], summary:{gap,low,over,ok}, contractCount, hasAny } */
  function analyze(customer) {
    if (!global.CovAgg || !global.CovAgg.summarize) {
      return { results: [], summary: { gap: 0, low: 0, over: 0, ok: 0 }, contractCount: 0, hasAny: false };
    }
    var r = global.CovAgg.summarize(customer);
    var byKey = {};
    (r.groups || []).forEach(function (g) { byKey[g.cat.key] = g; });

    var results = [];
    Object.keys(STANDARDS).forEach(function (key) {
      var std = STANDARDS[key];
      var g = byKey[key];
      var icon = iconFor(key);

      // 가입 여부형(실손·간병 등): 금액 비교 없이 있음/없음만
      if (std.presenceOnly) {
        var has = !!(g && g.items && g.items.length);
        results.push({
          key: key, label: std.label, icon: icon, presenceOnly: true,
          status: has ? 'ok' : 'gap', essential: !!std.essential, has: has,
          current: 0, target: 0, count: g ? g.items.length : 0,
          priority: has ? 0 : (std.essential ? 100 : 55)
        });
        return;
      }

      var cur = won0(g);
      var lumpItems = g ? (g.items || []).filter(function (it) { return it.ok && !it.perDay; }) : [];
      var status, priority = 0;
      if (cur <= 0) { status = 'gap'; priority = std.essential ? 90 : 50; }
      else if (cur < (std.min || 0)) { status = 'low'; priority = std.essential ? 70 : 40; }
      else { status = 'ok'; priority = 0; }

      // 중복/과다 점검: 일시금 항목이 2건 이상이고 합계가 상한을 넘으면
      if (std.dupAt && lumpItems.length >= 2 && cur > std.dupAt) {
        if (status === 'ok') { status = 'over'; priority = 30; }
        else { priority += 5; } // 부족인데 건수만 많은 경우는 낮게
      }

      results.push({
        key: key, label: std.label, icon: icon, presenceOnly: false,
        status: status, essential: !!std.essential,
        current: cur, target: std.min || 0, count: lumpItems.length,
        priority: priority
      });
    });

    results.sort(function (a, b) { return b.priority - a.priority; });

    var summary = { gap: 0, low: 0, over: 0, ok: 0 };
    results.forEach(function (x) { if (summary[x.status] != null) summary[x.status]++; });

    return { results: results, summary: summary, contractCount: r.contractCount || 0, hasAny: !!r.hasAny };
  }

  /* ── 화면용 ──────────────────────────────────────────────── */
  var COLOR = { gap: '#C2402A', low: '#B45309', over: '#7C3AED', ok: '#1A7F4B' };
  var WORD  = { gap: '공백', low: '부족', over: '중복·과다', ok: '적정' };

  function fmt(won) {
    return (global.CovAgg && global.CovAgg.fmtWon) ? global.CovAgg.fmtWon(won) : (Math.round(won).toLocaleString() + '원');
  }

  function chip(label, n, color) {
    var dim = !n;
    return '<span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:var(--r-full);' +
      'background:' + (dim ? 'var(--surface)' : color) + ';color:' + (dim ? 'var(--text3)' : '#fff') + ';' +
      'border:1px solid ' + (dim ? 'var(--border)' : color) + ';">' + label + ' ' + n + '</span>';
  }

  function msgFor(x) {
    if (x.presenceOnly) {
      return x.essential
        ? x.label + ' 보장이 없습니다. 가입 검토를 권합니다(필수).'
        : x.label + ' 보장이 없습니다. 필요 시 검토하세요.';
    }
    if (x.status === 'gap') {
      return x.essential
        ? x.label + ' 보장이 없습니다. 최소 ' + fmt(x.target) + ' 이상 신규 제안.'
        : x.label + ' 보장이 없습니다. 필요 시 ' + fmt(x.target) + ' 검토.';
    }
    if (x.status === 'low') {
      var diff = x.target - x.current;
      return '현재 ' + fmt(x.current) + ' → 권장 ' + fmt(x.target) +
        (diff > 0 ? ' (약 ' + fmt(diff) + ' 부족). 증액 검토.' : '. 증액 검토.');
    }
    if (x.status === 'over') {
      return x.count + '건 합산 ' + fmt(x.current) + ' (권장 ' + fmt(x.target) + ' 초과). 중복 점검·리모델링 여지.';
    }
    return '';
  }

  function actionCard(x) {
    var c = COLOR[x.status];
    var right = x.presenceOnly
      ? '<span style="font-size:11px;font-weight:800;color:' + c + ';">미가입</span>'
      : (x.status === 'gap'
          ? '<span style="font-size:11px;font-weight:800;color:' + c + ';">없음</span>'
          : '<span style="font-size:14px;font-weight:800;color:' + c + ';">' + fmt(x.current) + '</span>');
    return '<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border);' +
      'border-left:3px solid ' + c + ';border-radius:var(--radius-sm);background:var(--surface);margin-bottom:7px;">' +
      '<span style="font-size:17px;line-height:1.2;">' + x.icon + '</span>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
          '<span style="font-size:13px;font-weight:800;">' + x.label + '</span>' +
          '<span style="font-size:9.5px;font-weight:800;padding:1px 6px;border-radius:var(--r-xs);background:' + c + ';color:#fff;">' + WORD[x.status] + '</span>' +
          (x.essential ? '<span style="font-size:9.5px;font-weight:700;color:var(--text3);">필수</span>' : '') +
        '</div>' +
        '<div style="font-size:11.5px;color:var(--text2);line-height:1.55;margin-top:3px;">' + msgFor(x) + '</div>' +
      '</div>' +
      '<div style="white-space:nowrap;padding-top:1px;">' + right + '</div>' +
    '</div>';
  }

  function renderHTML(customer, opts) {
    opts = opts || {};
    var a = analyze(customer);
    if (!a.hasAny) {
      return '<div style="font-size:12px;color:var(--text3);padding:12px;text-align:center;">분석할 담보가 없어요.</div>';
    }
    var s = a.summary;
    var actions = a.results.filter(function (x) { return x.status !== 'ok'; });

    var head =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px;flex-wrap:wrap;">' +
        '<div style="font-size:13px;font-weight:800;">🔎 보장 분석' +
          '<span style="font-size:11px;font-weight:500;color:var(--text3);margin-left:6px;">권장 기준 대비</span></div>' +
        '<div style="display:flex;gap:5px;flex-wrap:wrap;">' +
          chip(WORD.gap, s.gap, COLOR.gap) + chip(WORD.low, s.low, COLOR.low) +
          chip(WORD.over, s.over, COLOR.over) + chip(WORD.ok, s.ok, COLOR.ok) +
        '</div>' +
      '</div>';

    var body = actions.length
      ? actions.map(actionCard).join('')
      : '<div style="font-size:12.5px;color:' + COLOR.ok + ';font-weight:700;padding:12px;text-align:center;' +
        'border:1px dashed var(--border);border-radius:var(--radius-sm);">현재 기준상 보강·정리할 항목이 없어요 👍</div>';

    var note =
      '<div style="font-size:10.5px;color:var(--text3);line-height:1.6;margin-top:9px;background:var(--bg,transparent);' +
      'padding:8px 10px;border-radius:var(--r-xs);">' +
      '※ 권장 금액은 운영자가 설정한 <b>일반 가이드</b>로, 약관·진단 종류·지급조건에 따라 실제 필요는 달라집니다. ' +
      '실손·일당·비례형은 금액이 아닌 <b>가입 여부</b>만 봤어요. 영업 자료가 아닌 내부 점검용입니다.' +
      '</div>';

    return '<div>' + head + body + note + '</div>';
  }

  global.CovGap = {
    STANDARDS: STANDARDS,
    analyze: analyze,
    renderHTML: renderHTML
  };
})(typeof window !== 'undefined' ? window : this);
