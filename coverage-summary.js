/* 무진 보장 합산 엔진  (coverage-summary.js)
 * ─────────────────────────────────────────────────────────
 * 한 고객의 여러 계약(손보+생보)에 흩어진 담보를
 *  "보장 카테고리"별로 묶어서 합산해 보여준다.
 *
 * 핵심 아이디어
 *  - 담보명은 회사마다 다름(골절진단비 vs 재해골절). 그래서 이름 일치가 아니라
 *    카테고리 키워드로 분류 → 같은 카테고리끼리 금액을 더한다.
 *  - 손보/생보를 보험사명으로 구분해서 카테고리 안에서 한 번 더 나눠 보여준다.
 *  - 금액은 "5,000만원 / 1억 / 3만원" 같은 문자열이라 숫자(원)로 파싱한다.
 *  - 입원일당 등 "/일" 담보는 일시금과 성격이 달라 따로 합산.
 *  - 실손·비례·% 처럼 고정금액이 아닌 건 합산에서 제외하고 목록만 보여준다.
 *
 * ⚠️ 카테고리 규칙(CATS)은 아래에서 자유롭게 수정/추가하세요.
 *    위에 있는 규칙이 먼저 매칭됩니다(구체적인 것일수록 위로).
 *    화면에 담보별 원본이 다 보이니, 엉뚱하게 묶이면 키워드만 고치면 됩니다.
 * ───────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  // 보험사명으로 생보 판별 (admin/viewer의 isLifeCompany/isLife와 동일 규칙)
  function isLifeCompany(name) {
    return /생명|생보|라이프|한화생|삼성생|교보생|흥국생|동양생|미래에셋생|푸본현대생|처브라이프|AIA|DB생명|KDB생명|ABL생명|DGB생명|iM라이프|메트라이프|신한라이프|카카오페이생명/.test(name || '');
  }

  // ── 보장 카테고리 규칙 (순서 중요: 위에서부터 먼저 매칭) ──
  // re: 담보명에 매칭할 정규식 / lump: 일시금성 보장인지(true면 합산 대상)
  var CATS = [
    { key: 'cancer',  label: '암 진단',      icon: '🎗', re: /암|악성|유사암|소액암|고액암|제자리암|경계성|상피내/ },
    { key: 'brain',   label: '뇌혈관',       icon: '🧠', re: /뇌졸중|뇌출혈|뇌경색|뇌혈관|뇌질환/ },
    { key: 'heart',   label: '심장질환',     icon: '❤️', re: /심근경색|허혈성|심장|협심증|심혈관/ },
    { key: 'ci',      label: '주요질환(2·3대 등)', icon: '🚨', re: /2대|3대|주요질환|중대한질병|중대질병|CI|특정질병진단/ },
    { key: 'fracture',label: '골절·외상',    icon: '🦴', re: /골절|깁스|화상|치아파절|외상|탈구/ },
    { key: 'surgery', label: '수술',         icon: '🔪', re: /수술/ },
    { key: 'disability', label: '후유장해',  icon: '♿', re: /후유장해|장해|장애/ },
    { key: 'hospital',label: '입원',         icon: '🛏', re: /입원/ },
    { key: 'visit',   label: '통원·외래',    icon: '🚶', re: /통원|외래|응급실/ },
    { key: 'death',   label: '사망',         icon: '🕊', re: /사망|유족|상해사망|재해사망/ },
    { key: 'driver',  label: '운전자',       icon: '🚗', re: /벌금|변호사|교통사고처리|운전자|자동차사고|면허정지|면허취소/ },
    { key: 'liability',label: '배상책임',    icon: '⚖️', re: /배상|일상생활|가족생활/ },
    { key: 'fire',    label: '화재·재물',    icon: '🔥', re: /화재|재물|도난|풍수해|폭발|붕괴/ },
    { key: 'care',    label: '간병·치매',    icon: '🧓', re: /간병|장기요양|치매|LTC|인지장애/ },
    { key: 'dental',  label: '치아',         icon: '🦷', re: /치아|임플란트|크라운|치과|보철/ },
    { key: 'silson',  label: '실손의료비',   icon: '🏥', re: /실손|실비/, noSum: true }, // 비례보상이라 단순합산 X
    { key: 'diag',    label: '기타 진단',    icon: '🩺', re: /진단/ },
    { key: 'etc',     label: '기타 보장',    icon: '📦', re: /.*/ } // 마지막: 나머지 전부
  ];

  function categorize(name) {
    name = name || '';
    for (var i = 0; i < CATS.length; i++) if (CATS[i].re.test(name)) return CATS[i];
    return CATS[CATS.length - 1];
  }

  // ── 금액 문자열 → 원 단위 숫자 ──
  // "5,000만원" → 50000000 / "1억" → 100000000 / "1억5,000만원" → 150000000
  // "50만원" → 500000 / "3만원/일" → perDay
  function parseAmount(raw) {
    if (!raw) return { ok: false };   // 0·''·null·undefined 모두 여기서 처리
    var s = String(raw).replace(/,/g, '').replace(/\s/g, '');
    if (!s) return { ok: false };
    var perDay = /\/일|일당|매일|1일|하루/.test(s);
    // 고정금액 아님(실손/비례/한도/%)
    if (/(실손|실비|비례|보상한도)/.test(s) && !/억|만원/.test(s)) return { ok: false, perDay: perDay, raw: raw };
    if (/%/.test(s) && !/억|만/.test(s)) return { ok: false, perDay: perDay, raw: raw };

    var won = 0, matched = false, m;
    m = s.match(/([\d.]+)억/);
    if (m) { won += parseFloat(m[1]) * 1e8; matched = true; }
    m = s.match(/([\d.]+)만/);
    if (m) { won += parseFloat(m[1]) * 1e4; matched = true; }
    if (!matched) {
      m = s.match(/([\d.]+)원/);
      if (m) { won += parseFloat(m[1]); matched = true; }
      else { m = s.match(/^[\d.]+$/); if (m) { won += parseFloat(m[0]) * 1e4; matched = true; } } // 단위 없으면 만원으로 가정
    }
    if (!matched || !won || isNaN(won)) return { ok: false, perDay: perDay, raw: raw };
    return { ok: true, won: won, perDay: perDay, raw: raw };
  }

  // 원 → 보기 좋은 한글 금액
  function fmtWon(won) {
    if (!won) return '0원';
    var eok = Math.floor(won / 1e8);
    var man = Math.round((won % 1e8) / 1e4);
    var out = '';
    if (eok) out += eok + '억';
    if (man) out += (eok ? ' ' : '') + man.toLocaleString() + '만원';
    if (!eok && !man) out = Math.round(won).toLocaleString() + '원';
    return out;
  }

  function getCoverages(ct) {
    return ct.coverages || (ct.rawJson && ct.rawJson.담보목록) || [];
  }

  // ── 핵심: 고객 → 카테고리별 합산 결과 ──
  function summarize(customer) {
    var contracts = (customer && customer.contracts) || [];
    var bucket = {}; // key → {cat, items:[], lumpWon, lumpWonLife, lumpWonNon, dayWon}
    CATS.forEach(function (c) {
      bucket[c.key] = { cat: c, items: [], lumpWon: 0, lumpWonLife: 0, lumpWonNon: 0, dayWon: 0, excluded: [] };
    });

    contracts.forEach(function (ct) {
      var company = ct.company || (ct.rawJson && ct.rawJson.보험사) || '';
      var life = isLifeCompany(company);
      getCoverages(ct).forEach(function (cv) {
        var name = cv.name || cv.담보명 || '';
        if (!name) return;
        var amtRaw = cv.amount || cv.보장금액 || '';
        // 보장단계(amountLevels)면 최댓값을 대표로
        var staged = false;
        if ((!amtRaw || !parseAmount(amtRaw).ok) && cv.amountLevels && cv.amountLevels.length) {
          var best = 0, bestRaw = '';
          cv.amountLevels.forEach(function (l) {
            var p = parseAmount(l.amount);
            if (p.ok && p.won > best) { best = p.won; bestRaw = l.amount; }
          });
          if (best) { amtRaw = bestRaw; staged = true; }
        }
        var p = parseAmount(amtRaw);
        var cat = categorize(name);
        var b = bucket[cat.key];
        var item = {
          name: name, company: company, life: life,
          raw: amtRaw, won: p.ok ? p.won : 0,
          perDay: !!p.perDay, ok: p.ok, staged: staged
        };
        b.items.push(item);
        if (cat.noSum) { item.ok = false; b.excluded.push(item); }
        else if (p.ok && p.perDay) { b.dayWon += p.won; }
        else if (p.ok) {
          b.lumpWon += p.won;
          if (life) b.lumpWonLife += p.won; else b.lumpWonNon += p.won;
        } else { b.excluded.push(item); }
      });
    });

    // 비어있지 않은 카테고리만, CATS 순서대로
    var groups = CATS.map(function (c) { return bucket[c.key]; })
      .filter(function (b) { return b.items.length > 0; });

    return {
      groups: groups,
      contractCount: contracts.length,
      hasAny: groups.length > 0
    };
  }

  // ── 화면용 HTML 생성 (admin 모달 / viewer 상세 공용) ──
  var _seq = 0;
  function tag(txt, color) {
    return '<span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px;background:' + color + ';color:#fff;margin-left:4px;">' + txt + '</span>';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function renderHTML(customer, opts) {
    opts = opts || {};
    var r = summarize(customer);
    if (!r.hasAny) {
      return '<div style="font-size:12px;color:var(--text3);padding:12px;text-align:center;">합산할 담보가 없어요.</div>';
    }
    var uid = 'cvagg' + (++_seq);

    // 헤드라인(오른쪽 금액) 생성
    function headFor(lump, day, count, both, nonW, lifeW) {
      var h = '';
      if (lump > 0) {
        h = '<span style="font-size:15px;font-weight:800;color:var(--accent);">' + fmtWon(lump) + '</span>';
        if (both) h += '<div style="font-size:10px;color:var(--text3);margin-top:1px;">손 ' + fmtWon(nonW) + ' · 생 ' + fmtWon(lifeW) + '</div>';
      } else if (day > 0) {
        h = '<span style="font-size:14px;font-weight:800;color:var(--accent);">' + fmtWon(day) + '<span style="font-size:10px;color:var(--text3);">/일</span></span>';
      } else {
        h = '<span style="font-size:11px;color:var(--text3);">한도형 ' + count + '건</span>';
      }
      if (lump > 0 && day > 0) h += '<div style="font-size:10px;color:var(--text3);margin-top:1px;">+ 일당 ' + fmtWon(day) + '/일</div>';
      return h;
    }
    // 담보 1줄
    function itemLine(it, showSideTag) {
      var amt = it.ok ? '<b style="color:var(--text);">' + esc(it.raw) + '</b>'
        : '<span style="color:var(--text3);">' + esc(it.raw || '-') + (it.perDay ? '' : ' · 합산제외') + '</span>';
      return '<div style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px dashed var(--border);font-size:12px;">' +
        '<div style="min-width:0;">' + esc(it.name) +
        (showSideTag ? tag(it.life ? '생보' : '손보', it.life ? '#7C3AED' : '#0E7490') : '') +
        (it.staged ? tag('단계', '#B45309') : '') +
        '<div style="font-size:10px;color:var(--text3);">' + esc(it.company) + '</div></div>' +
        '<div style="white-space:nowrap;">' + amt + '</div></div>';
    }
    // 카테고리 행 1개
    function catRow(rid, cat, count, headHTML, itemsHTML) {
      return '<div style="border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:7px;overflow:hidden;background:var(--surface);">' +
        '<div onclick="window.CovAgg.toggle(\'' + rid + '\')" style="display:flex;align-items:center;gap:9px;padding:11px 12px;cursor:pointer;">' +
        '<span style="font-size:17px;">' + cat.icon + '</span>' +
        '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;">' + cat.label +
        '<span style="font-size:11px;font-weight:500;color:var(--text3);margin-left:5px;">' + count + '건</span></div></div>' +
        '<div style="text-align:right;">' + headHTML + '</div>' +
        '<span id="' + rid + '_ar" style="color:var(--text3);font-size:11px;margin-left:4px;">▼</span>' +
        '</div>' +
        '<div id="' + rid + '_d" style="display:none;padding:2px 12px 9px;">' + itemsHTML + '</div>' +
        '</div>';
    }

    // ── 뷰 A: 통합 (카테고리별, 손/생 인라인) ──
    var combined = r.groups.map(function (g, gi) {
      var both = g.lumpWonNon > 0 && g.lumpWonLife > 0;
      var head = headFor(g.lumpWon, g.dayWon, g.items.length, both, g.lumpWonNon, g.lumpWonLife);
      var items = g.items.map(function (it) { return itemLine(it, true); }).join('');
      return catRow(uid + '_c' + gi, g.cat, g.items.length, head, items);
    }).join('');

    // ── 뷰 B: 손보 / 생보 구분 ──
    function sideBlock(isLife, tagPrefix) {
      var rows = '', n = 0;
      r.groups.forEach(function (g, gi) {
        var its = g.items.filter(function (it) { return !!it.life === isLife; });
        if (!its.length) return;
        n += its.length;
        var lump = 0, day = 0;
        its.forEach(function (it) { if (it.ok && it.perDay) day += it.won; else if (it.ok) lump += it.won; });
        var head = headFor(lump, day, its.length, false, 0, 0);
        var items = its.map(function (it) { return itemLine(it, false); }).join('');
        rows += catRow(uid + tagPrefix + gi, g.cat, its.length, head, items);
      });
      if (!n) return '';
      var color = isLife ? '#7C3AED' : '#0E7490';
      return '<div style="font-size:12px;font-weight:800;color:' + color + ';margin:4px 0 7px;">' +
        (isLife ? '🟣 생명보험' : '🔵 손해보험') + '<span style="font-size:11px;font-weight:500;color:var(--text3);margin-left:5px;">담보 ' + n + '개</span></div>' + rows;
    }
    var split = sideBlock(false, '_n') + '<div style="height:10px;"></div>' + sideBlock(true, '_l');

    // ── 토글 버튼 ──
    function tabBtn(mode, label, active) {
      return '<button onclick="window.CovAgg.view(\'' + uid + '\',\'' + mode + '\')" id="' + uid + '_tab_' + mode + '" ' +
        'style="flex:1;padding:7px 0;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;border:1px solid var(--border);' +
        'background:' + (active ? 'var(--accent)' : 'var(--surface)') + ';color:' + (active ? '#fff' : 'var(--text2)') + ';">' + label + '</button>';
    }
    var tabs = '<div style="display:flex;gap:0;border-radius:var(--radius-sm);overflow:hidden;border:1px solid var(--border);margin-bottom:10px;">' +
      tabBtn('combined', '통합', true) + tabBtn('split', '손·생 구분', false) + '</div>';

    return '<div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px;">' +
      '<div style="font-size:13px;font-weight:800;">🛡 보장 합산<span style="font-size:11px;font-weight:500;color:var(--text3);margin-left:6px;">계약 ' + r.contractCount + '건 기준</span></div>' +
      '</div>' +
      tabs +
      '<div id="' + uid + '_combined">' + combined + '</div>' +
      '<div id="' + uid + '_split" style="display:none;">' + split + '</div>' +
      '<div style="font-size:10.5px;color:var(--text3);line-height:1.6;margin-top:8px;background:var(--bg,transparent);padding:8px 10px;border-radius:8px;">' +
      '※ 담보명을 카테고리로 묶어 더한 <b>단순 합계</b>예요. 실제 지급은 약관·진단 종류·지급조건에 따라 달라질 수 있어요(예: 유사암·소액암은 일반암보다 적게 지급). 실손은 비례보상이라 합산에서 제외했어요.' +
      '</div></div>';
  }

  function view(uid, mode) {
    var c = document.getElementById(uid + '_combined');
    var s = document.getElementById(uid + '_split');
    var tc = document.getElementById(uid + '_tab_combined');
    var ts = document.getElementById(uid + '_tab_split');
    if (!c || !s) return;
    var on = mode === 'split';
    c.style.display = on ? 'none' : 'block';
    s.style.display = on ? 'block' : 'none';
    [[tc, !on], [ts, on]].forEach(function (p) {
      if (!p[0]) return;
      p[0].style.background = p[1] ? 'var(--accent)' : 'var(--surface)';
      p[0].style.color = p[1] ? '#fff' : 'var(--text2)';
    });
  }

  function toggle(rid) {
    var d = document.getElementById(rid + '_d');
    var ar = document.getElementById(rid + '_ar');
    if (!d) return;
    var open = d.style.display !== 'none';
    d.style.display = open ? 'none' : 'block';
    if (ar) ar.textContent = open ? '▼' : '▲';
  }

  global.CovAgg = {
    isLifeCompany: isLifeCompany,
    categorize: categorize,
    parseAmount: parseAmount,
    fmtWon: fmtWon,
    summarize: summarize,
    renderHTML: renderHTML,
    toggle: toggle,
    view: view,
    CATS: CATS
  };
})(typeof window !== 'undefined' ? window : this);
