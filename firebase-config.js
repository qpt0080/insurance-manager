/* ============================================================
 *  firebase-config.js — Firebase 설정 단일 원본
 *  ------------------------------------------------------------
 *  모든 페이지(admin/viewer/dashboard/notice/awards-compare/
 *  awards-manage/income-simulator)가 이 파일을 import 해서 사용한다.
 *  설정이 바뀌면 여기 한 곳만 고치면 된다.
 *
 *  ※ sw.js(서비스워커)는 compat/importScripts 환경이라 ES import를
 *    쓸 수 없어 자체 사본을 둔다. 값이 바뀌면 sw.js도 함께 수정할 것.
 *
 *  참고: 웹 Firebase의 apiKey는 클라이언트에 공개되는 식별자이며
 *        비밀키가 아니다(보안은 Firestore 보안 규칙으로 처리).
 * ============================================================ */
export const firebaseConfig = {
  apiKey: "AIzaSyCIwydl1W9ODV-RcNi6b5xyiPSQfHxgOnM",
  authDomain: "insurance-manager-c4308.firebaseapp.com",
  projectId: "insurance-manager-c4308",
  storageBucket: "insurance-manager-c4308.firebasestorage.app",
  messagingSenderId: "769412429451",
  appId: "1:769412429451:web:0c3a31bb14430f8fe5068e"
};
