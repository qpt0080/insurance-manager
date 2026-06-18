/* ============================================================
 *  share-core.js — 고객 보장 공유 링크 공통 모듈 (보험Manager)
 *  ------------------------------------------------------------
 *  목적: 설계사가 "고객용 보장 요약" 링크를 만들고(viewer/admin),
 *        고객이 그 링크를 여는(my.html) 양쪽이 같은 규칙을 쓰게 함.
 *
 *  동작 개요 (방식 ②: 토큰 링크 + 생년월일 확인)
 *   1) 담보 관련 필드만 추려(pickCoverageData) JSON 스냅샷을 만든다.
 *      → 전화·주민번호·주소·메모·agentId 등은 절대 포함하지 않음.
 *   2) 그 스냅샷을 "생년월일 6자리(YYMMDD)"에서 파생한 키로 암호화한다.
 *      (PBKDF2 → AES-GCM, Web Crypto). 토큰은 솔트로 사용.
 *   3) Firestore  shares/{token}  문서에는 "암호문"만 저장한다.
 *      → 문서를 그대로 읽어도 생년월일 없이는 해독 불가, 누구인지도 모름.
 *   4) 고객은 링크(토큰)를 열고 생년월일을 입력 → my.html이 복호화해 보여줌.
 *
 *  ⚠️ 솔직한 한계: 생년월일 6자리는 경우의 수가 적어(저엔트로피) "암호학적
 *     으로 강한" 잠금은 아니다. 링크가 실수로 새는 걸 막는 "한 겹 잠금"으로
 *     보면 된다. 더 강하게 하려면 Cloudflare Worker에서 시도 횟수를 제한하는
 *     방식으로 확장할 수 있다(추후).
 *
 *  의존성: 표준 Web Crypto(crypto.subtle) — https(또는 localhost)에서만 동작.
 *  window.ShareCore 로 노출. (firestore 함수는 호출 측에서 주입한다)
 * ============================================================ */
(function () {
  'use strict';
  if (window.ShareCore) return;

  var ITER = 150000;            // PBKDF2 반복(느릴수록 무차별 대입에 강함)
  var ENC = new TextEncoder();
  var DEC = new TextDecoder();

  /* ── base64url 인코딩/디코딩 ───────────────────────────────── */
  function bufToB64u(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uToBuf(str) {
    str = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    var s = atob(str), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b.buffer;
  }

  /* ── 추측 불가능한 토큰(16바이트 → 22자) ───────────────────── */
  function randomToken() {
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return bufToB64u(b.buffer);
  }

  /* ── 생년월일 정규화: 숫자 6자리(YYMMDD)만 추출 ─────────────── */
  function normBirth(s) {
    return String(s == null ? '' : s).replace(/\D/g, '').slice(0, 6);
  }
  function isValidBirth(s) { return /^\d{6}$/.test(normBirth(s)); }

  /* ── 생년월일 + 토큰(솔트) → AES-GCM 키 ────────────────────── */
  function deriveKey(birth6, token) {
    return crypto.subtle.importKey('raw', ENC.encode(normBirth(birth6)),
      { name: 'PBKDF2' }, false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: ENC.encode('mujin:' + token), iterations: ITER, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }

  /* ── 암호화: 객체 → {iv, ct} (둘 다 base64url) ─────────────── */
  function encrypt(dataObj, birth6, token) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(birth6, token).then(function (key) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key,
        ENC.encode(JSON.stringify(dataObj)));
    }).then(function (ctBuf) {
      return { iv: bufToB64u(iv.buffer), ct: bufToB64u(ctBuf) };
    });
  }

  /* ── 복호화: {iv, ct} → 객체 (틀린 생년월일이면 throw) ──────── */
  function decrypt(payload, birth6, token) {
    return deriveKey(birth6, token).then(function (key) {
      return crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(b64uToBuf(payload.iv)) },
        key, b64uToBuf(payload.ct));
    }).then(function (buf) {
      return JSON.parse(DEC.decode(buf));
    });
  }

  /* ── 담보 관련 필드만 추리기(민감정보 제외) ─────────────────── */
  function getCoverages(ct) {
    return ct.coverages || (ct.rawJson && ct.rawJson.담보목록) || [];
  }
  function pickCoverageData(customer) {
    var contracts = (customer && customer.contracts) || [];
    return {
      v: 1,
      name: (customer && (customer.name || customer.고객명)) || '',
      contracts: contracts.map(function (ct) {
        return {
          company: ct.company || (ct.rawJson && ct.rawJson.보험사) || '',
          product: ct.product || (ct.rawJson && ct.rawJson.상품명) || '',
          coverages: getCoverages(ct).map(function (cv) {
            var o = { name: cv.name || cv.담보명 || '', amount: cv.amount || cv.보장금액 || '' };
            if (cv.amountLevels && cv.amountLevels.length) o.amountLevels = cv.amountLevels;
            return o;
          })
        };
      })
    };
  }

  /* ── 공유 URL 만들기 (현재 폴더의 my.html 기준) ─────────────── */
  function buildUrl(token) {
    var u = new URL('my.html', location.href);
    u.search = '?t=' + token;
    return u.href;
  }

  /* ── 토큰 추출(고객 페이지용) ──────────────────────────────── */
  function tokenFromUrl() {
    var m = location.search.match(/[?&]t=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  /* ── 핵심: 스냅샷 만들어 Firestore에 저장 ───────────────────
   *  fb = { db, doc, setDoc }  (호출 측 모듈에서 주입)
   *  반환: Promise<{token, url}> */
  function createShare(customer, birth6, fb) {
    if (!isValidBirth(birth6)) return Promise.reject(new Error('생년월일 6자리를 정확히 입력하세요.'));
    var data = pickCoverageData(customer);
    var token = randomToken();
    return encrypt(data, birth6, token).then(function (enc) {
      return fb.setDoc(fb.doc(fb.db, 'shares', token), {
        iv: enc.iv, ct: enc.ct, ver: 1,
        agentId: fb.agentId || null,   // 발급자(설계사 uid) — 본인만 회수 가능하도록
        createdAt: new Date().toISOString()
      });
    }).then(function () {
      return { token: token, url: buildUrl(token) };
    });
  }

  /* ── 링크 생성 다이얼로그(설계사 화면용) ────────────────────
   *  생년월일 입력 → 생성 → 링크/복사/공유 안내까지 한 번에.
   *  ui-feedback.js의 toast가 있으면 사용. fb = { db, doc, setDoc } */
  function openShareDialog(customer, fb) {
    injectCSS();
    var defBirth = normBirth((customer && (customer.birth || customer.생년월일 || customer.birth6)) || '');
    var back = el('div', 'shc-back');
    back.innerHTML =
      '<div class="shc-modal">' +
        '<div class="shc-title">📲 고객 보장 링크 만들기</div>' +
        '<div class="shc-desc">' + esc(customer && customer.name || '고객') +
          '님이 링크를 열고 <b>생년월일 6자리</b>를 입력하면 본인 보장 요약을 볼 수 있어요.</div>' +
        '<label class="shc-lab">생년월일 6자리 (YYMMDD)</label>' +
        '<input class="shc-inp" inputmode="numeric" maxlength="6" placeholder="예: 880317" value="' + esc(defBirth) + '">' +
        '<div class="shc-err"></div>' +
        '<div class="shc-btns">' +
          '<button class="shc-btn shc-cancel">취소</button>' +
          '<button class="shc-btn shc-ok">링크 생성</button>' +
        '</div>' +
        '<div class="shc-result" style="display:none;"></div>' +
      '</div>';
    document.body.appendChild(back);
    requestAnimationFrame(function () { back.classList.add('show'); });
    var inp = back.querySelector('.shc-inp');
    var err = back.querySelector('.shc-err');
    var okB = back.querySelector('.shc-ok');
    var result = back.querySelector('.shc-result');
    inp.focus();

    function close() { back.classList.remove('show'); setTimeout(function () { back.remove(); }, 160); }
    back.querySelector('.shc-cancel').addEventListener('click', close);
    back.addEventListener('click', function (e) { if (e.target === back) close(); });

    okB.addEventListener('click', function () {
      var b = normBirth(inp.value);
      if (!isValidBirth(b)) { err.textContent = '생년월일 6자리(YYMMDD)를 정확히 입력하세요.'; return; }
      err.textContent = ''; okB.disabled = true; okB.textContent = '생성 중…';
      createShare(customer, b, fb).then(function (res) {
        result.style.display = 'block';
        result.innerHTML =
          '<div class="shc-url-lab">✅ 링크가 만들어졌어요 — 고객에게 보내세요</div>' +
          '<div class="shc-url" tabindex="0">' + esc(res.url) + '</div>' +
          '<div class="shc-act">' +
            '<button class="shc-btn shc-copy">링크 복사</button>' +
            (navigator.share ? '<button class="shc-btn shc-share">공유</button>' : '') +
          '</div>' +
          '<div class="shc-tip">고객은 링크를 연 뒤 <b>생년월일 6자리</b>를 입력합니다. ' +
          '폰 홈 화면에 추가하면 아이콘으로 바로 열 수 있어요. ' +
          '링크를 회수하려면 시상 데이터처럼 이 공유 문서를 삭제하면 됩니다.</div>';
        var copyB = result.querySelector('.shc-copy');
        copyB.addEventListener('click', function () {
          (navigator.clipboard ? navigator.clipboard.writeText(res.url) : Promise.reject())
            .then(function () { toastSafe('링크를 복사했어요', 'success'); })
            .catch(function () { selectText(result.querySelector('.shc-url')); toastSafe('길게 눌러 복사하세요'); });
        });
        var shB = result.querySelector('.shc-share');
        if (shB) shB.addEventListener('click', function () {
          navigator.share({ title: '내 보장 요약', url: res.url }).catch(function () {});
        });
        okB.style.display = 'none';
        back.querySelector('.shc-cancel').textContent = '닫기';
      }).catch(function (e) {
        okB.disabled = false; okB.textContent = '링크 생성';
        err.textContent = (e && e.message) || '생성에 실패했어요. 다시 시도하세요.';
      });
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') okB.click(); });
  }

  /* ── 작은 유틸 ─────────────────────────────────────────────── */
  function el(tag, cls) { var d = document.createElement(tag); if (cls) d.className = cls; return d; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function toastSafe(msg, type) { if (window.toast) window.toast(msg, type ? { type: type } : undefined); }
  function selectText(node) {
    try { var r = document.createRange(); r.selectNodeContents(node); var s = getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) {}
  }

  var cssInjected = false;
  function injectCSS() {
    if (cssInjected) return; cssInjected = true;
    var css =
      '.shc-back{position:fixed;inset:0;background:rgba(20,22,30,.46);z-index:2147483600;display:flex;' +
        'align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity .16s;}' +
      '.shc-back.show{opacity:1;}' +
      '.shc-modal{width:100%;max-width:380px;background:#fff;border-radius:var(--r-md);padding:20px;' +
        'box-shadow:0 18px 50px rgba(20,22,30,.3);font-family:inherit;transform:scale(.96);transition:transform .16s;}' +
      '.shc-back.show .shc-modal{transform:scale(1);}' +
      '.shc-title{font-size:16px;font-weight:800;color:#1A1C22;margin-bottom:6px;}' +
      '.shc-desc{font-size:12.5px;line-height:1.6;color:#4A4F5A;margin-bottom:14px;}' +
      '.shc-lab{display:block;font-size:11.5px;font-weight:700;color:#6A6F7A;margin-bottom:5px;}' +
      '.shc-inp{width:100%;box-sizing:border-box;font-size:18px;letter-spacing:3px;text-align:center;' +
        'padding:12px;border:1.5px solid #D9DCE3;border-radius:var(--r-sm);font-family:inherit;}' +
      '.shc-inp:focus{outline:none;border-color:#3B5BDB;}' +
      '.shc-err{min-height:16px;font-size:11.5px;color:#C2402A;font-weight:600;margin:6px 2px 0;}' +
      '.shc-btns{display:flex;gap:8px;margin-top:10px;}' +
      '.shc-btn{flex:1;padding:11px 12px;border-radius:var(--r-sm);font-size:14px;font-weight:700;border:none;cursor:pointer;font-family:inherit;}' +
      '.shc-cancel{background:#EEF0F4;color:#4A4F5A;}' +
      '.shc-ok,.shc-copy,.shc-share{background:#3B5BDB;color:#fff;}' +
      '.shc-result{margin-top:16px;border-top:1px solid #EEF0F4;padding-top:14px;}' +
      '.shc-url-lab{font-size:12px;font-weight:700;color:#1A7F4B;margin-bottom:7px;}' +
      '.shc-url{font-size:12px;word-break:break-all;background:#F4F5F8;border:1px solid #E3E6EC;border-radius:var(--r-xs);' +
        'padding:10px 12px;color:#1A1C22;line-height:1.5;}' +
      '.shc-act{display:flex;gap:8px;margin-top:10px;}' +
      '.shc-tip{font-size:11px;line-height:1.6;color:#8A8F9A;margin-top:11px;}';
    var s = document.createElement('style'); s.setAttribute('data-shc', '1'); s.textContent = css;
    document.head.appendChild(s);
  }

  window.ShareCore = {
    randomToken: randomToken,
    normBirth: normBirth,
    isValidBirth: isValidBirth,
    encrypt: encrypt,
    decrypt: decrypt,
    pickCoverageData: pickCoverageData,
    buildUrl: buildUrl,
    tokenFromUrl: tokenFromUrl,
    createShare: createShare,
    openShareDialog: openShareDialog
  };
})();
