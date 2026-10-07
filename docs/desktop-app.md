# Windows PC 앱

관련 Issue: #371(앱), #372(확장 연결), #373(설치·업데이트·자동 시작).

## 기존 사용자와의 호환성

PC 앱은 별도 패키지입니다. 기존 extension-v0.2.x 릴리스, 웹 대시보드, API 및 로컬 IndexedDB 데이터는 유지합니다. 확장 v0.3.0은 웹 연결을 유지하면서 PC 앱 연결을 추가합니다. 기존 확장을 삭제하지 않고 같은 ID와 설치 폴더에서 업데이트합니다.

## 사용

1. Windows 설치 파일의 완료 화면에서 바탕 화면·시작 메뉴 바로가기와 앱 실행 여부를 선택합니다. 자동 업데이트에서는 기존 바로가기를 유지합니다. 앱의 `resources/extension` 폴더에 같은 릴리스의 Chrome 확장이 함께 설치됩니다.
2. 첫 실행의 확장 설치·연결 안내에서 경로를 복사하고 Chrome `chrome://extensions`의 개발자 모드 → 압축해제된 확장 로드로 해당 폴더를 등록합니다. 기존 확장 사용자는 삭제·중복 등록 없이 연결할 수 있습니다.
3. 안내에서 연결 코드를 발급하고 Chrome 확장 팝업의 PC 앱 연결에 6자리 코드를 입력합니다. 코드는 2분 동안 한 번만 사용할 수 있습니다. 최초 한 번 승인하면 다음 앱 실행부터 자동 재연결하며, 이미 연결되어 있으면 코드 재입력 없이 설정을 완료할 수 있습니다.
4. 앱이 연결되면 로그인 없이 로컬 풀이를 확인할 수 있습니다. 서버 동기화와 GitHub 작업은 GitHub 로그인 후 명시적으로 실행합니다.
5. 앱 창을 닫으면 트레이에서 실행됩니다. 트레이 메뉴의 종료를 선택하면 완전히 종료합니다.

설정 완료 상태는 앱 사용자 데이터에 저장되어 재실행·업데이트 후 유지됩니다. 나중에를 선택하면 다음 실행에서 다시 안내하며, 설정 → PC 앱 설정 → 확장 설치 안내에서도 열 수 있습니다. 포함 파일만으로 Chrome에 자동 설치되거나 연결 승인되는 것은 아닙니다. 앱 업데이트가 확장 파일을 갱신한 뒤 Chrome에서도 확장을 새로고침해 주세요.

자동 시작은 기본으로 꺼져 있고 설치한 앱의 설정에서 켤 수 있습니다. Windows 로그인 시 트레이로 시작합니다. 기존 사이트 수집은 Chrome 확장에서 계속 진행하며 사이트 창 유지 안내가 적용됩니다. 앱만 종료해도 확장 로컬 수집은 영향을 받지 않습니다.

## 연결 및 로그인

PC 앱은 `127.0.0.1:18791`에만 바인딩합니다. `/pair` 및 `/bridge`는 정확한 CodeArchive 확장 Origin과 Host를 검사하며 일반 웹 페이지와 다른 확장 Origin을 거부합니다. 연결 코드는 실패 5회, 2분 만료, 1회 소비를 적용합니다. 승인 후 256비트 토큰을 발급하고 앱에는 Windows 보안 저장소로 암호화해 저장합니다. 확장은 자신의 Chrome storage에 토큰을 저장합니다. 연결 해제는 토큰과 소켓을 폐기하며 풀이를 삭제하지 않습니다.

연결 때 양쪽의 새 nonce와 역할별 HMAC으로 앱·확장이 서로 인증합니다. 이전 연결에서 받은 challenge와 READY는 새 연결에서 재사용할 수 없으며, 지속 토큰은 재연결 메시지로 보내지 않습니다. 연결 코드는 요청 본문을 받은 뒤에도 같은 발급 세대·만료·시도 횟수를 재확인합니다.

확장 서비스 워커는 별도 PC 세션 identity에 기존 DashboardBridge 계약을 적용합니다. 웹 세션과 capability를 공유하지 않으며 읽기만으로 ACK 권한이 생기지 않습니다. 기존 서버 업로드 성공 후 ACK·계정 검증·설정 버전 계약을 재사용합니다.

Electron renderer에는 Node.js 권한이 없습니다. sandbox, contextIsolation, CSP 및 main-frame IPC 검증을 적용합니다. API 요청은 기존 운영 로그인/API Origin의 `/api/` 경로와 허용 헤더만 접근합니다. 앱의 로그인 버튼을 누르면 서버 응답을 기다리지 않고 기본 웹브라우저를 열며, GitHub 인증 화면으로 바로 이동합니다. 중간 웹 로그인 버튼 없이 인증 완료 후 앱으로 돌아갑니다. 브라우저가 표시하는 앱 열기 확인은 수락해야 하며, 자동 이동이 차단되면 완료 화면의 CodeArchive 앱 열기를 사용할 수 있습니다. 앱 전용 persistent 세션은 원래 앱이 일회용 증명을 교환해 생성합니다. 브라우저와 앱의 세션은 별도이므로 Chrome을 닫아도 앱 로그인은 유지됩니다. Chrome 계정 쿠키나 프로필은 읽지 않습니다. 기존 OAuth callback과 Netlify API 프록시 주소는 유지합니다. GitHub App 설치도 웹브라우저에서 같은 계정을 확인하고 새 브라우저 세션에 설치 state를 발급하며, 설치 후 앱에서 연결 버튼을 다시 눌러 목록을 확인합니다. 이 브랜치는 Netlify를 배포하지 않습니다.

확장 팝업은 PC 앱에 연결되지 않았을 때 연결 코드 입력만 표시하고, 연결되면 연결 영역을 숨깁니다. 연결이 끊기면 다시 연결 화면으로 돌아갑니다. 별도 확장 업데이트 조회·항목은 제거했으며 앱 릴리스의 포함 확장으로 갱신합니다.

### 웹 로그인 API 적용

관련 Issue #378, #383. 서버에는 `/api/desktop-auth`와 V22·V23 마이그레이션을 추가했습니다. V23은 임시 로그인 요청의 콜백 필수 여부와 일회용 코드 해시를 추가하며 기존 요청은 이전 교환 방식을 유지합니다. `DESKTOP_LOGIN_ENABLED`는 기본 `false`입니다. 기존 API 배포와 데이터베이스 마이그레이션 검증 후 이 플래그를 활성화해야 새 PC 앱의 웹 로그인이 동작합니다. Netlify 웹 빌드·배포는 필요하지 않습니다.

앱은 256비트 verifier, S256 challenge와 별도의 state를 생성합니다. 브라우저의 `/api/desktop-auth/start`가 5분 동안 유효한 요청을 생성하고 GitHub OAuth로 바로 이동합니다. 인증 완료 화면은 일회용 코드·요청 ID·state를 `codearchive://auth/complete`로 앱에 전달합니다. 앱은 자신이 시작한 state를 확인하고 보관 중인 verifier와 코드를 교환해 독립 세션을 생성합니다. 다른 앱의 state, 중복 콜백, 잘못된 코드·verifier와 만료된 요청은 거부합니다. 코드만으로 로그인할 수 없으며 데이터베이스 요청에는 코드 해시만 저장합니다. verifier·앱 세션 쿠키·GitHub 토큰은 URL·renderer·로그에 전달하지 않습니다. 기존 로그인 폼은 CSRF 검사를 유지하며 GitHub로 이어지는 폼 이동만 CSP에서 허용합니다. 요청 할당은 데이터베이스 잠금으로 여러 서버 인스턴스에서 직렬화하고 전체 500개·서버가 해석한 동일 클라이언트당 10개의 대기 요청 제한과 만료 정리를 적용합니다. 공유 프록시·NAT 환경의 제한은 실제 배포에서 확인해야 합니다.

## 빌드와 검증

PC 앱과 확장의 공통 아이콘 원본은 `shared/branding/codearchive.png`입니다. 원본을 교체한 뒤 Windows에서 `./scripts/generate-icons.ps1`을 실행하면 비율·투명도를 유지한 확장 PNG와 앱·트레이 PNG, 여러 크기의 Windows ICO를 생성합니다. 생성한 아이콘도 소스에 포함하므로 CI에서 변환 도구를 설치할 필요는 없습니다.

```powershell
npm --prefix apps/dashboard ci
npm --prefix apps/desktop ci
npm --prefix apps/extension ci
npm --prefix apps/desktop test
npm --prefix apps/desktop run pack
npm --prefix apps/desktop run dist
```

개발 실행은 `npm --prefix apps/desktop run build` 후 `npm --prefix apps/desktop start`입니다. 확장 빌드는 기본으로 기존 build.local.json 설치 폴더를 백업 후 갱신합니다. 격리 검증에서는 `CODEARCHIVE_SKIP_INSTALLED_EXTENSION=true`로 설치 폴더 반영을 생략할 수 있습니다.

`test:smoke`는 `CODEARCHIVE_DESKTOP_TEST_USER_DATA`와 `CODEARCHIVE_DESKTOP_SMOKE_OUTPUT`를 별도 검증 폴더로 지정하여 실행합니다. 앱 renderer·IPC·합성 확장 peer·실제 providers 읽기 API를 검증하며, 실제 사용자 Chrome 연결 검증을 대체하지 않습니다. 선택형 `DesktopBrowserSmokeTest`는 로컬 H2와 테스트 전용 GitHub 성공 응답·콜백 전달로 Chrome 이동과 Electron 세션 교환을 확인합니다. 실제 Google/GitHub 공급자 로그인과 Windows 프로토콜 전달 검증은 별도로 필요합니다. 배포 패키지에는 smoke driver가 포함되지 않습니다.

## 릴리스와 업데이트

공개 릴리스의 기준 브랜치는 항상 `master`입니다. 구현 PR은 `develop` 대상으로 진행하고, 검증된 버전을 `master`에 승격한 후 릴리스를 발행합니다. `master` 승격만으로 Netlify 배포를 요청한 것으로 간주하지 않습니다.

- 수동 발행: `gh workflow run desktop-release.yml --ref master -f publish=true` (확장은 `extension-release.yml`).
- 태그 발행: `master`의 현재 커밋 또는 이전 릴리스 커밋에 버전과 일치하는 `desktop-vX.Y.Z` / `extension-vX.Y.Z` 태그를 만듭니다. 병합된 기능 브랜치의 커밋을 직접 태그하는 것도 거부하고 `master`의 첫 번째 부모 이력에 있는 커밋만 허용합니다.
- 두 워크플로는 빌드·서명 전에 master 출처를 검사합니다. 버전별 릴리스 노트와 앱 버전·태그를 일치시키고 기존 릴리스 자산은 덮어쓰지 않습니다.
- PC 앱 업데이트 메타데이터에는 서명 대상인 `source.branch=master`, `source.commit`이 포함됩니다. 후속 버전에도 기존 앱의 공개키와 일치하는 같은 업데이트 서명 키를 사용해야 합니다.

GitHub Actions desktop-release는 Windows NSIS 설치 파일, 버전별 노트, Ed25519 서명된 업데이트 메타데이터를 생성합니다. signing 전용 `CODEARCHIVE_DESKTOP_UPDATE_KEY` secret이 필요하고 공개키와 일치하지 않으면 릴리스를 만들 수 없습니다. 개인키는 커밋·로그에 남기지 않습니다.

앱은 desktop-v 태그의 안정 릴리스만 선택합니다. 기존 확장 릴리스와 버전이 섞이지 않습니다. 앱 시작과 실행 중 6시간마다 자동 확인하고 설정에서도 확인할 수 있습니다. 사용자가 다운로드·적용을 선택하면 서명, 정확한 GitHub 설치 파일 URL, 더 높은 버전, SHA256을 검증합니다. 진행 중인 앱 요청이 있으면 설치를 거부합니다. 업데이트 파일은 사용자 데이터 폴더에 저장하며 installer는 shell 없이 실행합니다.

업데이트 무결성 서명은 Windows SmartScreen용 Authenticode 서명과 별개입니다. 현재 베타 installer는 Authenticode 인증서가 없어 Windows 게시자 경고가 표시될 수 있습니다. 업데이트에 사용한 개인키는 이후 버전에서도 동일하게 보관해야 합니다.
