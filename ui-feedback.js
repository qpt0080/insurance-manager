/* ============================================================
 *  ui-feedback.js — 공용 토스트 / 확인 모달 (보험Manager)
 *  ------------------------------------------------------------
 *  window.toast(msg, opts)      : 잠깐 떴다 사라지는 알림(논블로킹)
 *      opts = { type:'info'|'success'|'error', duration:ms }
 *      - type 미지정 시 메시지에 실패/오류/에러 등이 있으면 자동 error
 *  window.uiConfirm(msg, opts)  : 확인/취소 모달. Promise<boolean> 반환
 *      opts = { okText, cancelText, danger:true }
 *      - 확인=true, 취소/배경클릭/Esc=false
 *
 *  의존성 없음. 첫 호출 시 스타일·컨테이너를 자동 주입한다.
 *  네이티브 alert()/confirm() 대체용.
 * ============================================================ */
(function () {
  'use strict';
  if (window.toast && window.uiConfirm) return; // 중복 로드 방지

  var ACCENT = '#3B5BDB', INK = '#1A1C22', RED = '#C2402A', GREEN = '#1A7F4B';
  var injected = false;

  function injectCSS() {
    if (injected) return; injected = true;
    var css =
      '.uifb-toasts{position:fixed;left:0;right:0;bottom:calc(20px + env(safe-area-inset-bottom));' +
      'display:flex;flex-direction:column;align-items:center;gap:8px;z-index:2147483000;pointer-events:none;padding:0 16px;}' +
      '.uifb-toast{pointer-events:auto;max-width:420px;width:fit-content;box-sizing:border-box;' +
      'background:' + INK + ';color:#fff;font-size:13.5px;line-height:1.5;font-weight:600;' +
      'padding:11px 16px;border-radius:12px;box-shadow:0 8px 24px rgba(20,22,30,.28);' +
      'white-space:pre-line;text-align:center;opacity:0;transform:translateY(8px);' +
      'transition:opacity .2s ease,transform .2s ease;}' +
      '.uifb-toast.show{opacity:1;transform:translateY(0);}' +
      '.uifb-toast.error{background:' + RED + ';}' +
      '.uifb-toast.success{background:' + GREEN + ';}' +
      /* 모달 */
      '.uifb-back{position:fixed;inset:0;background:rgba(20,22,30,.44);z-index:2147483600;' +
      'display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity .16s ease;}' +
      '.uifb-back.show{opacity:1;}' +
      '.uifb-modal{width:100%;max-width:340px;background:#fff;border-radius:16px;' +
      'padding:20px 20px 16px;box-shadow:0 18px 50px rgba(20,22,30,.3);' +
      'transform:scale(.96);transition:transform .16s ease;font-family:inherit;}' +
      '.uifb-back.show .uifb-modal{transform:scale(1);}' +
      '.uifb-msg{font-size:14.5px;line-height:1.6;color:' + INK + ';font-weight:600;' +
      'white-space:pre-line;margin-bottom:18px;}' +
      '.uifb-btns{display:flex;gap:8px;}' +
      '.uifb-btn{flex:1;padding:11px 12px;border-radius:10px;font-size:14px;font-weight:700;' +
      'border:none;cursor:pointer;font-family:inherit;}' +
      '.uifb-cancel{background:#EEF0F4;color:#4A4F5A;}' +
      '.uifb-ok{background:' + ACCENT + ';color:#fff;}' +
      '.uifb-ok.danger{background:' + RED + ';}';
    var s = document.createElement('style');
    s.setAttribute('data-uifb', '1');
    s.textContent = css;
    document.head.appendChild(s);
  }

  function toastHost() {
    var h = document.querySelector('.uifb-toasts');
    if (!h) { h = document.createElement('div'); h.className = 'uifb-toasts'; document.body.appendChild(h); }
    return h;
  }

  window.toast = function (msg, opts) {
    injectCSS();
    opts = opts || {};
    var type = opts.type;
    if (!type) {
      type = /실패|오류|에러|없습니다|없어요|불가|초과|취소됨/.test(String(msg)) ? 'error' : 'info';
    }
    var el = document.createElement('div');
    el.className = 'uifb-toast' + (type === 'error' ? ' error' : type === 'success' ? ' success' : '');
    el.textContent = String(msg == null ? '' : msg);
    toastHost().appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    var dur = opts.duration || (type === 'error' ? 3400 : 2400);
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 220);
    }, dur);
  };

  window.uiConfirm = function (msg, opts) {
    injectCSS();
    opts = opts || {};
    return new Promise(function (resolve) {
      var back = document.createElement('div');
      back.className = 'uifb-back';
      var modal = document.createElement('div');
      modal.className = 'uifb-modal';
      var m = document.createElement('div');
      m.className = 'uifb-msg';
      m.textContent = String(msg == null ? '' : msg);
      var btns = document.createElement('div');
      btns.className = 'uifb-btns';
      var cancel = document.createElement('button');
      cancel.className = 'uifb-cancel uifb-btn';
      cancel.textContent = opts.cancelText || '취소';
      var ok = document.createElement('button');
      ok.className = 'uifb-ok uifb-btn' + (opts.danger ? ' danger' : '');
      ok.textContent = opts.okText || '확인';
      btns.appendChild(cancel); btns.appendChild(ok);
      modal.appendChild(m); modal.appendChild(btns);
      back.appendChild(modal);
      document.body.appendChild(back);
      requestAnimationFrame(function () { back.classList.add('show'); ok.focus(); });

      var done = false;
      function close(val) {
        if (done) return; done = true;
        back.classList.remove('show');
        document.removeEventListener('keydown', onKey);
        setTimeout(function () { back.remove(); resolve(val); }, 160);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(false);
        else if (e.key === 'Enter') close(true);
      }
      cancel.addEventListener('click', function () { close(false); });
      ok.addEventListener('click', function () { close(true); });
      back.addEventListener('click', function (e) { if (e.target === back) close(false); });
      document.addEventListener('keydown', onKey);
    });
  };
})();
