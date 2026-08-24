import "./popup.css";

export function Popup() {
  return (
    <main className="popup" aria-labelledby="popup-title">
      <p className="eyebrow">CodeArchive</p>
      <h1 id="popup-title">로컬 우선 기록 준비 완료</h1>
      <p className="description">
        이 확장 프로그램은 현재 브라우저 안에서만 실행됩니다. API 연결, 로그인,
        네트워크 요청이나 추가 권한 없이 다음 기능을 준비하고 있어요.
      </p>
      <ul>
        <li>풀이 직접 등록</li>
        <li>로컬 기록 조회</li>
        <li>Source · Markdown · JSON 내보내기</li>
      </ul>
      <p className="status" role="status">서버 연결 없음 · 로컬 프로토타입</p>
    </main>
  );
}