# CodeArchive

CodeArchive는 SWEA·프로그래머스·정올의 본인 정답 풀이를 기록하고, 확장에 포함된 대시보드에서 조회·동기화·GitHub 기록을 관리하는 Chrome 확장입니다. 별도 PC 앱 없이 Chrome 안에서 사용합니다.

[웹스토어 준비 안내](docs/extension-webstore.md) · [Issue](https://github.com/devkimhongjin/codeArchive/issues) · [기존 릴리스](https://github.com/devkimhongjin/codeArchive/releases)

## Chrome 확장 설치와 업데이트

현재는 **Chrome 웹스토어 제출 준비** 단계이며, 스토어 설치 링크는 아직 없습니다. `master`에서 만든 제출용 ZIP은 스토어 심사용 패키지이며, 스토어 게시·심사가 완료됐다는 의미는 아닙니다.

로컬 검증:

1. `npm run setup`, `npm run build`로 빌드합니다.
2. `chrome://extensions`에서 개발자 모드를 켜고 **압축해제된 확장 프로그램을 로드합니다**로 `apps/extension/dist`를 선택합니다.
3. 확장 팝업의 **대시보드 열기**를 누릅니다. 대시보드는 확장 전용 탭에서 열립니다.
4. 대시보드에서 GitHub 로그인 후 신규 정답의 자동 동기화를 확인합니다. GitHub App 저장소 연결은 로그인과 별도이며, 자동 커밋은 팝업 또는 대시보드에서 ON/OFF할 수 있습니다. 처음에는 대시보드에서 저장소를 연결합니다.
5. **과거 풀이 관리**에서 플랫폼·같은 문제 제출 기준을 선택해 수집합니다. 수집 화면과 원본 사이트 창을 모두 열어 두세요. 수집 완료 후 선택한 제출 중 원본 확인·저장에 성공한 항목의 일괄 동기화 또는 GitHub 커밋을 실행합니다. GitHub 작업은 미동기화 항목 동기화 후 저장소·브랜치·경로 확인으로 이어집니다.

기존 사용자는 **확장을 삭제하지 말고 기존에 로드한 폴더에 빌드 파일을 갱신한 뒤 새로고침(↻)** 하세요. 열린 관리 화면과 문제 탭도 코드를 확인한 뒤 새로고침합니다. 확장 삭제는 Chrome 프로필의 풀이 기록을 지울 수 있습니다.

이 사용 환경의 기존 폴더는 `%LOCALAPPDATA%\Programs\CodeArchive\resources\extension`입니다. 로컬 `apps/extension/build.local.json`에 `installedExtensionDir`을 지정하면 정규 빌드가 백업 후 그 폴더에 적용합니다. 개발자 개인 경로는 Git에 추가하지 않습니다. 웹스토어 ID가 기존 로컬 ID와 같거나 데이터가 자동 이전된다고 가정하지 않습니다.

이전 PC 앱 릴리스는 변경하지 않았습니다. 해당 버전의 설치 안내는 [기존 PC 앱 문서](docs/desktop-app.md)를 참고하세요. 신규 구조는 확장 단독이며 Windows 설치 파일 작업을 진행하지 않습니다.

## 현재 기능

| 영역 | 구현 범위 |
| --- | --- |
| 풀이 수집 | SWEA·Programmers·Jungol의 제출 시도와 성공 결과를 연결하고, 제출한 코드·문제·언어·시각을 저장 |
| 내부 보관·내보내기 | 동기화 재시도용 IndexedDB, 최근 동기화된 문제와 전체 코드 조회, 복사·다운로드 |
| 대시보드 | 문제별 제출 묶음, 검색·언어/플랫폼 필터·정렬, 코드 강조, 테마·파일명·주석 설정 |
| 계정·동기화 | GitHub 로그인, 사용자별 서버 저장, 신규 정답 자동 동기화, 과거 선택 제출 일괄 동기화 |
| GitHub 연동 | 개인 계정의 App 설치·저장소·브랜치·폴더 선택, 경로/커밋 메시지 설정, 자동 커밋과 작업 상태 |
| 저장소 관리 | 파일/폴더 트리 조회, 빈 저장소 초기화, 파일·폴더 추가, 이동·삭제 미리보기와 별도 커밋 확인 |
| 커뮤니티 | 본인 풀이를 공개한 문제에 한해 다른 공개 풀이 탐색. 신규 풀이 기본 공개·비공개를 계정 설정에서 선택 |

과거 풀이 수집은 로그인 없이 시작할 수 있습니다. 서버 목록·동기화·커뮤니티·GitHub 기능에는 로그인이 필요합니다. Chrome을 완전히 종료하면 확장 작업은 실행되지 않습니다.

### 플랫폼별 확인 범위

SWEA·프로그래머스·정올의 과거 수집 결과는 사용자 확인 기록이 있습니다. 최종 웹스토어 ZIP의 신규 정답 자동 동기화·팝업 상태·작업 복구와 스토어 ID의 로그인 검증은 [#400](https://github.com/devkimhongjin/codeArchive/issues/400)에 남깁니다. 단위 테스트 통과를 실브라우저 확인으로 기록하지 않습니다.

## 데이터 흐름

```text
사이트의 본인 정답 확인 → Extension 내부 보관 → 인증된 API 자동 동기화
  ├─ 확장 대시보드 조회·복사·다운로드·로컬 정적 분석
  ├─ 과거 수집: 선택한 원본 검증 → 완료 후 일괄 동기화 / GitHub 확인
  └─ GitHub 자동 커밋 ON: API 영속 작업 → Worker → 선택 저장소
```

신규 정답 자동 동기화는 항상 활성화되며 별도 OFF 설정이 없습니다. 로그인·계정 연결이 필요하고, 전송 실패 시 내부 기록을 보존해 재시도합니다. GitHub 자동 커밋은 별도 ON/OFF 설정이며, 저장소가 연결된 경우 팝업에서 바로 변경할 수 있습니다.

GitHub 로그인과 저장소 커밋 권한은 별도입니다. 자동 커밋에는 본인 GitHub App 설치와 저장 위치 선택이 필요합니다. 과거 수집 기록은 명시적인 일괄 작업으로 처리합니다. 결과를 확정할 수 없는 `UNKNOWN` 커밋은 자동 재시도하지 않고 결과 대조 후 처리합니다.

## 구성

| 경로 | 역할 | 기술 |
| --- | --- | --- |
| `apps/extension` | 제출 감지, 로컬 보관, Dashboard bridge, Relay | TypeScript, Chrome MV3, IndexedDB |
| `apps/dashboard` | 풀이 탐색, 설정, GitHub 연동, 커뮤니티 | React, TypeScript, Vite, Shiki |
| `apps/api` | 인증, 풀이·설정 저장, Relay, GitHub 작업 | Java 17, Spring Boot 3.5, Spring Security, JPA, Maven |
| `shared` | 언어·테마·빌드 정보 | TypeScript/JavaScript |
| `infra/gcp` | Cloud Run·Cloud Tasks 배포와 DB 사전 검사 | PowerShell, Node.js |

서버 데이터와 세션은 PostgreSQL에 저장하며 Flyway로 스키마를 관리합니다. 로컬 개발은 파일 기반 H2를 사용할 수 있습니다. UI는 [CodeArchive Figma](https://www.figma.com/design/MjmogsVNXfKIxuGbJ8btWh/CodeArchive-Dashboard-Archive-UI?node-id=5-2)를 참고했습니다.

## 로컬 시작

Node.js 22.12 이상, JDK 17 이상, Chrome 120 이상이 필요합니다. 아래 명령은 저장소 루트에서 실행합니다.

```powershell
npm run setup
npm run build
npm run dev
```

대시보드 주소는 `http://localhost:5173`입니다. 별도 터미널에서 API를 실행합니다.

```powershell
cd apps/api
# JAVA_HOME이 JDK 17 이상을 가리켜야 합니다.
./mvnw.cmd spring-boot:run "-Dspring-boot.run.profiles=local"
```

macOS/Linux에서는 `./mvnw`를 사용합니다. `local` 프로필의 H2 데이터는 `apps/api/data`에 저장되고, 대시보드의 `/api` 요청은 기본적으로 `localhost:8080`으로 전달됩니다.

### GitHub 로그인

GitHub OAuth App에 콜백 URL `http://localhost:5173/api/login/oauth2/code/github`를 등록한 뒤, **API를 실행할 터미널에서** 설정합니다.

```powershell
$env:GITHUB_CLIENT_ID = 'your-client-id'
$env:GITHUB_CLIENT_SECRET = 'your-client-secret'
$env:GITHUB_REDIRECT_URI = 'http://localhost:5173/api/login/oauth2/code/github'
$env:DASHBOARD_ORIGIN = 'http://localhost:5173'
```

자격증명이 없으면 GitHub 로그인이 비활성화됩니다. 이메일·비밀번호 가입은 제공하지 않습니다. 선택적으로 Git에서 제외된 `apps/api/config/application-local.properties`에 로컬 설정을 보관할 수 있으며, 비밀값은 공유하거나 커밋하지 않습니다.

GitHub 자동 커밋 개발에는 별도로 `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`가 필요합니다. App의 Setup URL과 설치 검증 절차는 [API 문서](apps/api/README.md#github-app-installation-callback)를 참고하세요. OAuth secret과 App private key는 서버에서만 사용합니다.

### 확장 프로그램 로드

1. `npm run build`로 빌드합니다.
2. Chrome의 `chrome://extensions`에서 개발자 모드를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**로 `apps/extension/dist`를 선택합니다.
4. 고정 ID `oohlcmihldmfninmdcmanddfmhoonmdl`을 확인하고 문제 페이지를 새로 엽니다.
5. 확장 팝업의 **대시보드 열기**로 로그인합니다. 신규 정답은 자동 동기화하고, 과거 수집 기록은 완료 후 일괄 작업으로 동기화합니다.

베타 ZIP의 체크섬 확인·설치·기록을 보존하는 업데이트 방법은 [확장 배포 안내](docs/extension-beta-distribution.md)를 참고하세요. 기존 확장 프로그램을 삭제하면 로컬 기록이 사라질 수 있으므로, 업데이트할 때는 같은 폴더의 파일을 교체하고 **새로고침**합니다. 이전 개발 ID의 기록은 모두 옮기기 전에 해당 확장을 삭제하지 않습니다.

### PostgreSQL

H2 대신 개발용 PostgreSQL을 사용하려면 다음을 실행합니다.

```powershell
$env:POSTGRES_PASSWORD = 'choose-your-local-password'
docker compose up -d postgres
$env:DB_USERNAME = 'codearchive'
$env:DB_PASSWORD = $env:POSTGRES_PASSWORD
$env:DATABASE_URL = 'jdbc:postgresql://localhost:5432/codearchive'
cd apps/api
./mvnw.cmd spring-boot:run
```

PostgreSQL은 Flyway 적용 후 Hibernate로 스키마를 검증합니다. 원격 `develop`에는 V1–V14가 있고, `prod` 프로필은 `codearchive_v2` 스키마를 사용합니다. 기존 운영 DB에 새 개발 DB의 이력을 그대로 적용하지 않습니다. 백업·스키마 비교·명시적 baseline 절차는 [마이그레이션 문서](apps/api/docs/database-migrations.md)를 참고하되, 문서의 과거 버전 집계와 실제 [SQL 목록](apps/api/src/main/resources/db/migration)을 함께 확인하세요.

## 검증

```powershell
# Dashboard와 Extension 테스트, 타입 검사·빌드
npm test
npm run build

# API 테스트
cd apps/api
./mvnw.cmd test
```

API 기본 테스트는 H2와 모의 외부 응답을 사용합니다. PostgreSQL 환경 변수가 없으면 PostgreSQL 전용 테스트는 건너뜁니다. Docker와 JDK가 준비되어 있으면 저장소 루트에서 `./scripts/test-postgres.ps1`로 임시 PostgreSQL 17 마이그레이션 검증을 실행할 수 있습니다.

GCP 배포 사전 검사는 다음으로 확인합니다.

```powershell
node --test infra/gcp/staging-db-preflight.test.mjs
pwsh -NoProfile -File infra/gcp/staging-db-preflight.integration.ps1
```

[Verify workflow](.github/workflows/verify.yml)는 두 클라이언트 테스트·빌드, API·PostgreSQL 마이그레이션, 배포 사전 검사를 실행합니다. 자동 테스트 통과만으로 실제 사이트 제출·OAuth·GitHub 쓰기·배포용 ZIP 설치가 검증되는 것은 아닙니다.

## 배포와 보안 경계

- 모든 공개 릴리스는 검증된 `master` 커밋을 기준으로 발행합니다. 구현 PR의 기본 대상은 `develop`이며, 릴리스 발행 전에 `master` 승격을 별도로 확인합니다. [PC 앱 릴리스·업데이트 절차](docs/desktop-app.md#릴리스와-업데이트)를 따릅니다.

- 현재 저장소의 [Netlify 설정](netlify.toml)은 Dashboard를 배포하고 `/api/*`를 Cloud Run API로 프록시합니다. 브라우저의 OAuth callback은 Dashboard origin을 사용합니다.
- [GCP 배포 구성](infra/gcp/README.md)은 공개 API와 비공개 GitHub worker, Cloud Tasks OIDC 호출을 나눕니다. API와 worker의 DB가 검증된 비운영 대상인지 확인한 뒤 수동 배포합니다. 파일에 있는 구성은 현재 서비스의 배포 커밋을 보증하지 않습니다.
- 기본 실행 모드는 `polling`이고, Cloud Tasks 배포에는 별도 환경 설정이 필요합니다. 내부 worker endpoint는 비공개 서비스에서만 활성화해야 합니다.
- Dashboard bridge는 정확한 `http://localhost:5173`와 `https://codearchive-dashboard-beta.netlify.app`만 허용합니다. 다른 포트·`127.0.0.1`·유사 도메인은 연결 대상이 아닙니다.
- 계정은 GitHub 고유 ID로 구분하고, 서버는 계정별 데이터 접근과 설정 변경을 검사합니다. Extension에는 GitHub OAuth/App token을 전달하지 않고 제한된 Relay grant만 전달합니다.
- 문제 본문 전체·공식 해설·비공개 테스트 데이터·플랫폼 로그인 정보를 아카이브하지 않습니다. 소스 코드나 비밀값을 로그에 포함하지 않는 오류 처리도 유지합니다.

## 남은 작업

- 사이트 UI와 편집기 변경에 대한 실제 제출 검증을 지속하고, 로컬 수정분을 원격 통합·배포 검증으로 연결합니다.
- 동일한 Release ZIP을 새로 설치하거나 기존 설치에 덮어썼을 때의 ID·기록 보존·동기화 흐름을 확인합니다.
- 커뮤니티의 기존 풀이 공개 전환과 사용자 검증은 [#364](https://github.com/devkimhongjin/codeArchive/issues/364), [#365](https://github.com/devkimhongjin/codeArchive/issues/365)에 기록합니다.
- 현재 정적 분석은 캐시 식별자 기반 코드만 있으며, 분석 실행 worker와 사용자 기능은 후속 범위입니다. 이전 구조의 AI 분석 서비스를 현재 제공 기능으로 표시하지 않습니다.

성능 수치는 플랫폼이 표시하는 선택적 제출 메타데이터입니다. Programmers는 테스트별 시간 합계·메모리 평균을 사용하고, SWEA/Jungol과 측정 조건이 다릅니다. 단위를 알 수 없는 이전 메모리는 **단위 미확인**으로 표시하며, 수집하지 못한 값을 추정하지 않습니다.
