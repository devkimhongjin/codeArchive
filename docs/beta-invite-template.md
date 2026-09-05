# 지인 베타 초대·업데이트 메시지

운영자용 양식입니다. [배포 점검표](beta-distribution-checklist.md)와 [릴리스·업데이트 정책](beta-release-update-policy.md)을 완료하고 아래 빈칸을 실제 값으로 채운 뒤 직접 전달합니다. 이 문서를 작성했다고 초대·업로드·배포가 자동 실행되는 것은 아닙니다.

---

## 신규 테스터 전달 예시

안녕하세요! SWEA 정답 풀이를 모아보는 **CodeArchive**의 출시 전 베타 테스트를 부탁드리고 싶어요.

Chrome 확장 프로그램이 정답 코드를 내 브라우저에 저장하고, 웹 Dashboard에서 GitHub 로그인·동기화·풀이 관리를 할 수 있습니다. Chrome 웹 스토어 앱이 아니라 압축 해제 설치 방식이라 아래 설치 안내를 먼저 읽어주세요. 개발 도구나 서버 설치는 필요 없습니다.

- Dashboard: https://codearchive-dashboard-beta.onrender.com
- 설치 ZIP: **[운영자가 실제 파일 첨부 또는 접근 가능한 비공개 링크 입력]**
- ZIP SHA-256: **[지인에게 실제 전달하는 ZIP의 새 확인값 입력]**
- 버전 / 소스 커밋: **[release-info.json 값과 실제 배포 기록 입력]**
- 업데이트 중요도: **[필수 / 권장 / 선택]**
- 사용 가능 확인 일시 / 테스트 기간: **[운영자 입력]**
- 문의·오류 제보: **[연락 채널 입력]**
- Dashboard 초대 비밀번호: **별도 비공개 연락으로 전달**
- 현재 알려진 문제: **[검증 결과와 후속 Issue 기준 입력]**

이번 버전 Release Note:

**[주요 변경 / 보안·개인정보 영향 / 알려진 문제를 사용자 관점에서 짧게 입력]**

설치 안내와 사용 가이드의 최신 원본은 GitHub에 있습니다.

- [설치·업데이트](https://github.com/devkimhongjin/codeArchive/blob/develop/docs/beta-install.md)
- [사용 가이드](https://github.com/devkimhongjin/codeArchive/blob/develop/docs/dashboard-beta-tester-guide.md)
- [문제 해결](https://github.com/devkimhongjin/codeArchive/blob/develop/docs/beta-troubleshooting.md)

지인 전달용 ZIP에는 운영 문서 `docs/` 폴더가 없을 수 있습니다. 받은 ZIP의 `README.md`, 운영자가 함께 보낸 Release Note와 위 온라인 문서를 기준으로 사용해주세요. 온라인 문서는 패키지보다 최신일 수 있으니 받은 버전 안내를 우선합니다.

처음에는 본인이 작성한 중요하지 않은 테스트 풀이로 아래 순서를 확인해주세요.

1. SWEA 정답 제출 후 **로컬 풀이 보기**에서 저장 확인
2. Dashboard 초대 비밀번호 입력 → GitHub 로그인·계정 확인·Extension 연결 확인
3. 대기 중인 코드 전송에 동의하는 경우에만 **자동 동기화** 켜기
4. Dashboard에서 풀이 찾기·복사·다운로드
5. 불편한 점이나 오류를 코드/개인정보 없이 알려주기

베타라 중요한 데이터의 유일한 보관 장소로 사용하지 말아주세요. 기존 Extension 제거나 브라우저 데이터 삭제 전에 Source/Markdown 사본을 보관해주세요. 현재 AI의 `fake` 표시는 실제 AI 분석이 아닌 기능 테스트 결과일 수 있습니다. 자동 동기화 동의와 AI 생성 동의, 풀이 공개 동의는 서로 별개입니다.

회사·학교 비공개 코드, 타인 코드, 비밀번호·API 키가 포함된 코드는 전송하거나 공개하지 말아주세요. 자동 동기화를 켜면 대기 중인 로컬 기록 전체가 대상이 될 수 있습니다. 원하지 않으면 로컬 기능만 사용하거나 테스트를 중단해도 됩니다.

초대 비밀번호는 같은 탭에서 한 번 확인하는 입장 안내용이며, 계정 인증이나 강력한 서버 접근 제한을 대신하지 않습니다. 다른 사람에게 재공유하지 말아주세요.

---

## 기존 사용자 업데이트 전달 예시

CodeArchive Beta **[버전]** 업데이트입니다.

업데이트 중요도: **[필수 / 권장 / 선택]**

주요 변경:
- **[변경 1]**
- **[변경 2]**
- **[변경 3]**

알려진 문제:
- **[없음 또는 후속 Issue/제한]**

업데이트 전에 중요한 풀이는 Source/Markdown으로 백업해주세요.

**기존 CodeArchive Extension을 Chrome에서 제거하지 마세요.**

1. 자동 동기화를 잠시 끕니다.
2. 새 ZIP을 별도 위치에 압축 해제합니다.
3. 새 `extension` 내부 파일을 기존에 Chrome이 로드하고 있는 CodeArchive 폴더에 복사·덮어씁니다.
4. `chrome://extensions`에서 기존 CodeArchive의 새로고침 버튼을 누릅니다.
5. SWEA와 Dashboard를 새로고침합니다.
6. Extension ID와 기존 로컬 풀이가 유지되는지 확인합니다.
7. 정상일 때만 자동 동기화를 다시 켭니다.

ZIP SHA-256: **[실제 전달본 값]**
문의: **[비공개 연락 채널]**

Chrome에서 Extension 삭제, Chrome 프로필/사이트 데이터 삭제, IndexedDB 초기화는 업데이트 절차가 아닙니다.
