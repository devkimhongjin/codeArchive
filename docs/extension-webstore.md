# Chrome 웹스토어 준비

관련 Issue: #400. 현재 상태는 **패키지 준비**이며 웹스토어 등록·심사·게시를 완료한 상태가 아닙니다. Windows 설치 파일 작업은 중지했습니다. 공개 릴리스는 `develop` 검증 후 `master`의 코드로 만듭니다.

## 패키지 생성

```powershell
npm --prefix apps/dashboard ci
npm --prefix apps/extension ci
node --test scripts/extension-store-package.test.mjs
npm --prefix apps/extension run build
node scripts/extension-store-package.mjs prepare
```

기본 출력은 `output/chrome-webstore`입니다. 이미 생성한 파일을 덮어쓰지 않습니다. 다시 생성할 때는 새로운 출력 폴더를 지정합니다.

```powershell
node scripts/extension-store-package.mjs prepare apps/extension/dist output/chrome-webstore-next
```

| 파일 | 내용 |
| --- | --- |
| `codearchive-chrome-webstore.zip` | 루트 manifest와 컴파일된 확장·대시보드·수집 화면 |
| `codearchive-chrome-webstore.zip.sha256` | ZIP SHA256 |
| `package-report.json` | 포함 파일별 크기·SHA256, 권한, 로컬 ID 및 남은 검증 |

패키지 생성은 원본 manifest, 실제 Chrome 설치 폴더, 브라우저 데이터, 서버 설정을 수정하지 않습니다. 소스맵을 제외하고 JavaScript의 소스맵 참조를 제거합니다. 개발용 `http://localhost:5173/*`를 host permissions와 externally connectable에서 제외하고, 제거된 연동 가이드에 쓰던 `https://api.github.com/*` 권한도 ZIP에서는 제외하며, 확장 페이지 CSP를 `script-src 'self'; object-src 'self';`로 명시합니다. 로컬 개발 빌드는 기존 설정을 유지합니다.

manifest의 버전·공개 키·로컬 ID 계약, 권한·사이트 범위, manifest와 HTML이 참조하는 로컬 파일을 검사합니다. 예상 밖 파일, 심볼릭 링크, 누락 파일, HTML 인라인 스크립트·이벤트 처리와 원격 script/link를 거부합니다. ZIP은 파일 순서와 타임스탬프를 고정합니다. 이 검사는 JavaScript 전체의 의미 분석이나 실제 Chrome 검증을 대신하지 않습니다. 실제 ZIP에 포함된 의존 코드도 원격 실행 코드가 없는지 검토해야 합니다.

`netlify.toml`의 `build.ignore = "exit 0"`으로 저장소 변경에 따른 웹 빌드를 중지합니다. 기존에 게시된 API 프록시는 사용하며, 이 작업에서 새 Netlify 배포를 실행하지 않습니다.

CI도 준비 명령을 실행하며, 웹스토어에 업로드하거나 자동 게시하지 않습니다. 기존 GitHub 릴리스 워크플로의 master 제한은 유지합니다.

## 스토어 설명 초안

**단일 목적:** SWEA·프로그래머스·정올의 본인 정답 풀이를 기록하고, CodeArchive에서 풀이 조회·동기화·선택한 GitHub 저장소 기록을 관리합니다.

**상세 설명:** 정답 제출의 코드와 문제 정보를 기록합니다. 확장에 포함된 관리 탭에서 풀이 검색, 코드 테마, 과거 제출 수집, 서버 동기화와 GitHub 커밋을 관리합니다. 로그인 후 신규 정답은 자동 동기화합니다. GitHub 자동 커밋은 저장소 연결과 별도 ON/OFF 설정에 따릅니다. 커뮤니티 공개 설정을 적용한 코드와 닉네임은 같은 문제의 풀이를 공개한 로그인 사용자에게 표시됩니다. Chrome을 완전히 종료하면 확장 작업은 실행되지 않습니다. 별도 PC 앱은 필요하지 않습니다.

## 권한 설명 초안

| 권한/대상 | 사용 이유 |
| --- | --- |
| `storage` | 확장 설정, 연결 상태, 재시도·수집 진행 정보를 Chrome 프로필에 보관합니다. 풀이 데이터는 IndexedDB에 보관합니다. |
| `alarms` | 관리 화면이 닫혀 있어도 동기화 재시도를 예약합니다. |
| `scripting` | 사용자가 시작한 과거 풀이 수집에서 해당 플랫폼 탭에 패키지의 수집 스크립트를 적용합니다. |
| `downloads` | 사용자가 선택한 풀이를 코드 파일로 내보냅니다. |
| SWEA·프로그래머스·정올 | 본인 정답 결과, 원본 코드, 문제 정보와 제출 기록을 확인합니다. |
| `codearchive-dashboard-beta.netlify.app` | 기존 API 프록시를 통한 계정 확인, 로그인 반환, 풀이 동기화, 설정·커뮤니티·GitHub 관리에 사용합니다. Netlify 웹 배포를 수행한다는 의미가 아닙니다. |
| `externally_connectable`의 CodeArchive origin | 기존 CodeArchive 페이지와의 제한된 메시지 연결 및 인증 후 확장 화면 복귀에 사용합니다. 일반 웹사이트의 관리 API 접근은 허용하지 않습니다. |

사용자 저장소 조회와 커밋은 인증된 CodeArchive API가 처리합니다. 제거된 연동 가이드의 `api.github.com` 권한은 웹스토어 ZIP에 포함하지 않습니다.

원격 JavaScript를 받아 실행하지 않으며 React와 Shiki 코드는 ZIP 안에 포함됩니다. 쿠키 읽기, 전체 방문 기록, 임의 사이트 접근 권한은 요청하지 않습니다. GitHub 로그인은 별도 브라우저 인증 페이지에서 처리하고 인증 쿠키 값은 Chrome이 관리합니다.

## 개인정보 안내

[데이터 처리 안내 초안](extension-privacy.md)에 수집 항목, 자동 동기화, 커뮤니티 공개와 GitHub 전송을 정리했습니다. 실제 게시 전에 보관 기간·삭제 요청 수단을 확정하고 안정적으로 공개 접근 가능한 개인정보처리방침 URL을 등록해야 합니다. GitHub 문서가 존재한다는 이유만으로 스토어의 모든 개인정보 항목이 충족된다고 판단하지 않습니다.

## 실제 ID와 출시 검증

현재 공개 키는 **로컬** 확장 ID `oohlcmihldmfninmdcmanddfmhoonmdl`을 유지합니다. 이를 웹스토어의 실제 Item ID로 간주하지 않습니다. 등록 후 스토어에서 발급된 ID·공개 키를 확인하고, 로컬 및 공개 빌드 ID·릴리스 계약·API 허용 origin을 함께 검증합니다. 기존 로컬 ID의 IndexedDB 기록이 다른 ID의 스토어 확장으로 자동 이전된다고 가정하지 않습니다. 이전 방식은 별도 사용자 검증이 필요합니다.

출시 전 확인:

- 최종 master 버전의 릴리스 노트와 ZIP 내용 일치.
- 실제 스토어 ID로 로그인 반환, API CORS와 계정·CSRF 경계 확인.
- 신규 정답 자동 동기화와 최근 동기화된 문제, 연결된 저장소 팝업 ON/OFF 확인.
- 전체 풀이·커뮤니티·과거 수집·수동 일괄 동기화/커밋 동작 확인.
- 관리 탭 이동·닫기, 확장 service worker 재시작, Chrome 재실행 후 중복 전송 없이 작업 상태 복구 확인.
- 최종 ZIP에 포함된 코드의 원격 코드 실행 여부 검토.
- 실제 화면 캡처, 개인정보 URL, 데이터 사용 고지와 권한 설명 준비.

## 공식 참고 자료

- [최초 게시와 ZIP 업로드](https://developer.chrome.com/docs/webstore/publish)
- [개인정보·단일 목적·권한 설명](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [웹스토어 공개 키와 개발용 확장 ID](https://developer.chrome.com/docs/extensions/reference/manifest/key)
- [Manifest V3 원격 코드 제한](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)

## 제출 자료와 확인 상태 (v0.3.1)

- [릴리스 노트](releases/extension-v0.3.1.md)
- [스토어 입력 초안·검증 절차](webstore/submission-v0.3.1.md)
- [개인정보 안내 초안](extension-privacy.md)
- 저장소의 `master`로 승격한 뒤 release build로 ZIP과 체크섬을 생성합니다. ZIP의 출처 SHA와 검증 결과는 준비 폴더의 별도 기록에 남깁니다.
- 아이콘 `apps/extension/icons/icon-128.png`은 포함합니다. 홍보 이미지와 실제 화면 캡처는 스토어 등록 전에 준비합니다.
- 실제 게시·심사 요청 전 스토어 ID, 로그인/API origin, 개인정보 보관·삭제·비공개 문의 절차, 아래 실브라우저 검증을 확정해야 합니다. 등록 완료로 표시하거나 #400을 종료하지 않습니다.
