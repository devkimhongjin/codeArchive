import { BUILD_METADATA, buildLabel } from '../../../shared/buildMetadata'
import { extensionRuntime } from './extensionEnvironment'
export function ExtensionSetupStatus({ localReady, serverReady }: { localReady: boolean; serverReady: boolean }) {
  if (!extensionRuntime()) return null
  return <section className="settings-card" aria-label="확장 설치 확인">
    <h2>확장 설치 확인</h2>
    <dl className="release-meta">
      <div><dt>현재 확장</dt><dd>v{BUILD_METADATA.version} · {buildLabel()}</dd></div>
      <div><dt>로컬 저장소</dt><dd>{localReady ? '연결됨' : '연결 확인 중'}</dd></div>
      <div><dt>서버 계정</dt><dd>{serverReady ? '로그인됨' : '로그인 후 사용할 수 있습니다'}</dd></div>
    </dl>
    <p>검증용 빌드는 기존에 등록한 확장 폴더를 갱신합니다. Chrome 확장 관리에서 새로고침(↻)한 뒤 팝업의 대시보드 열기로 이 화면에 돌아오세요.</p>
    <p>로컬 수집·조회는 로그인 없이 사용할 수 있습니다. 서버 동기화·GitHub·커뮤니티는 로그인 후 사용할 수 있습니다.</p>
    <p>수집 중에는 수집 화면과 원본 사이트 창을 함께 열어 두세요. Chrome을 완전히 종료하면 작업은 진행되지 않습니다. 다시 열어 완료 항목과 진행 상태를 확인하고 이어서 실행하세요.</p>
    <a href="https://github.com/devkimhongjin/codeArchive/releases" target="_blank" rel="noreferrer">릴리스 안내 ↗</a>
  </section>
}
