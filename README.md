# CodeArchive

CodeArchive는 SWEA·Programmers·Jungol에서 통과한 알고리즘 풀이를 브라우저에 먼저 보관하고, 개인 대시보드와 GitHub 저장소로 연결하는 풀이 아카이브입니다. 제출한 코드를 다시 복사해 파일을 만들고 커밋하는 반복 작업을 줄이면서, 서버 연결이 끊겨도 로컬 풀이를 남기는 데 초점을 맞춥니다.

[대시보드](https://codearchive-dashboard-beta.netlify.app) · [Issue](https://github.com/devkimhongjin/codeArchive/issues) · [확장 배포 이력](https://github.com/devkimhongjin/codeArchive/releases)

> 이 문서의 구현 기준은 2026-09-28 확인한 원격 `develop`의 [`4cb9676`](https://github.com/devkimhongjin/codeArchive/commit/4cb9676871f3d8d037ffe19d5d90fe1149a37343)입니다. 소스 병합, 로컬 실사용 확인, Release ZIP 검증, 운영 배포는 별도의 상태입니다. `master`에는 이전 구조가 남아 있습니다.

2026-09-28 기준 공개 GitHub Release는 아직 없습니다. 현재는 아래 소스 빌드 절차를 사용합니다. ZIP 생성 경로는 준비됐지만, 첫 prerelease는 정확한 패키지의 설치·업데이트와 기존 데이터 보존 검증 후 발행합니다([#282](https://github.com/devkimhongjin/codeArchive/issues/282)).

## 현재 기능

| 영역 | 구현 범위 |
| --- | --- |
| 풀이 수집 | SWEA·Programmers·Jungol의 제출 시도와 성공 결과를 연결하고, 제출한 코드·문제·언어·시각을 저장 |
| 로컬 아카이브 | IndexedDB 보관, 최근 풀이와 전체 코드 조회, 복사·다운로드, 선택적 자동 다운로드 |
| 대시보드 | 문제별 제출 묶음, 검색·언어/플랫폼 필터·정렬, 코드 강조, 테마·파일명·주석 설정 |
| 계정·동기화 | GitHub 로그인, 사용자별 서버 저장, 수동 동기화와 동의 기반 자동 Relay |
| GitHub 연동 | 개인 계정의 App 설치·저장소·브랜치·폴더 선택, 경로/커밋 메시지 설정, 자동 커밋과 작업 상태 |
| 저장소 관리 | 파일/폴더 트리 조회, 빈 저장소 초기화, 파일·폴더 추가, 이동·삭제 미리보기와 별도 커밋 확인 |
| 커뮤니티 | 본인 풀이를 공개한 문제에 한해 다른 공개 풀이 탐색. 원격 `develop`은 기본 비공개 |

로그인 없이도 확장 프로그램의 로컬 저장·코드 조회·다운로드를 사용할 수 있습니다. 대시보드가 서버에 연결되지 않은 경우에도 허용된 확장 프로그램에서 로컬 기록을 읽습니다.

### 플랫폼별 확인 범위

- **SWEA:** 수집과 선택적 실행 시간·메모리 보충을 구현했습니다. 기존 [실브라우저 검증 기록](docs/auto-connect-deployment-review.md)에는 PASS → 로컬 → 서버 저장과 재동기화 시 중복 없음이 남아 있습니다.
- **Programmers:** 현재 제출의 새 정답창과 코드 스냅샷을 연결하는 adapter를 구현했습니다. 실사이트 후속 확인은 [#314](https://github.com/devkimhongjin/codeArchive/issues/314)에 기록합니다.
- **Jungol:** 원격에는 제출 요청과 계정별 제출 내역을 대조하는 adapter가 들어 있습니다. [#319](https://github.com/devkimhongjin/codeArchive/pull/319)의 병합 시점에는 로컬 수집까지 확인하고, 원격 동기화·커밋은 [#311](https://github.com/devkimhongjin/codeArchive/issues/311)에 남겼습니다.

9월 28일에는 사이트 UI·SPA 이동 대응을 포함한 **후속 로컬 빌드**에서 Jungol·Programmers의 저장 → 자동 동기화 → GitHub 커밋을 사용자가 확인한 기록이 있습니다([Jungol 확인](https://github.com/devkimhongjin/codeArchive/issues/311#issuecomment-5862723794), [Programmers 확인](https://github.com/devkimhongjin/codeArchive/issues/314#issuecomment-5863053296)). 이는 위 원격 기준 커밋이나 배포용 ZIP을 검증했다는 뜻이 아닙니다. 통합·배포 현황과 ZIP 설치 확인은 [#282](https://github.com/devkimhongjin/codeArchive/issues/282)를 함께 확인하세요.

## 데이터 흐름

```text
사이트 제출 → 현재 시도의 통과 결과 확인 → Extension IndexedDB
  ├─ 로컬 조회·복사·다운로드
  ├─ 수동: Dashboard → 인증된 API 저장 → 저장된 항목만 ACK
  └─ 자동: 동의한 Relay → API 저장 → 영속 GitHub 작업 → Worker → GitHub
```

자동 동기화는 대시보드에서 로그인한 뒤 설정을 저장하고 Relay 연결을 마쳐야 동작합니다. 유효한 Relay와 자동 동기화 설정이 있으면 대시보드를 닫아도 확장 프로그램이 전송을 이어갑니다. 연결 실패·인증 만료 때는 로컬 기록을 보존하며 재연결 또는 재시도가 필요합니다.

**GitHub 로그인과 저장소 커밋 권한은 별도입니다.** 자동 커밋에는 서버의 GitHub App 설정, 본인 계정의 App 설치, 저장 위치 선택, 자동 동기화와 자동 커밋 동의가 필요합니다. 자동화 동의 이후 수집한 풀이를 대상으로 하며, 기존 기록을 일괄 커밋하지 않습니다.

동일한 경로에 같은 내용이 있으면 중복 커밋을 만들지 않습니다. 내용이 다르면 제출을 구분하는 새 경로에 보관합니다. 커밋 결과를 확정할 수 없는 작업은 `UNKNOWN`으로 남기고 자동으로 재시도하지 않습니다. 팝업의 로컬 저장·서버 동기화·GitHub 커밋 상태는 서로 구분됩니다.

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
5. 대시보드에서 확장 연결을 확인합니다. 서버 저장에는 GitHub 로그인 후 **지금 동기화**를 사용하거나 자동 동기화를 설정합니다.

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

- 현재 저장소의 [Netlify 설정](netlify.toml)은 Dashboard를 배포하고 `/api/*`를 Cloud Run API로 프록시합니다. 브라우저의 OAuth callback은 Dashboard origin을 사용합니다.
- [GCP 배포 구성](infra/gcp/README.md)은 공개 API와 비공개 GitHub worker, Cloud Tasks OIDC 호출을 나눕니다. API와 worker의 DB가 검증된 비운영 대상인지 확인한 뒤 수동 배포합니다. 파일에 있는 구성은 현재 서비스의 배포 커밋을 보증하지 않습니다.
- 기본 실행 모드는 `polling`이고, Cloud Tasks 배포에는 별도 환경 설정이 필요합니다. 내부 worker endpoint는 비공개 서비스에서만 활성화해야 합니다.
- Dashboard bridge는 정확한 `http://localhost:5173`와 `https://codearchive-dashboard-beta.netlify.app`만 허용합니다. 다른 포트·`127.0.0.1`·유사 도메인은 연결 대상이 아닙니다.
- 계정은 GitHub 고유 ID로 구분하고, 서버는 계정별 데이터 접근과 설정 변경을 검사합니다. Extension에는 GitHub OAuth/App token을 전달하지 않고 제한된 Relay grant만 전달합니다.
- 문제 본문 전체·공식 해설·비공개 테스트 데이터·플랫폼 로그인 정보를 아카이브하지 않습니다. 소스 코드나 비밀값을 로그에 포함하지 않는 오류 처리도 유지합니다.

## 남은 작업

- 사이트 UI와 편집기 변경에 대한 실제 제출 검증을 지속하고, 로컬 수정분을 원격 통합·배포 검증으로 연결합니다.
- 동일한 Release ZIP을 새로 설치하거나 기존 설치에 덮어썼을 때의 ID·기록 보존·동기화 흐름을 확인합니다.
- 원격의 명시적 공개 방식과 로컬 후속 작업의 자동 공유 방식은 아직 구분해야 합니다. 커뮤니티 정책 변경은 [#318](https://github.com/devkimhongjin/codeArchive/issues/318)의 통합·마이그레이션 상태를 확인하세요.
- 현재 정적 분석은 캐시 식별자 기반 코드만 있으며, 분석 실행 worker와 사용자 기능은 후속 범위입니다. 이전 구조의 AI 분석 서비스를 현재 제공 기능으로 표시하지 않습니다.

성능 수치는 플랫폼이 표시하는 선택적 제출 메타데이터입니다. Programmers는 테스트별 시간 합계·메모리 평균을 사용하고, SWEA/Jungol과 측정 조건이 다릅니다. 단위를 알 수 없는 이전 메모리는 **단위 미확인**으로 표시하며, 수집하지 못한 값을 추정하지 않습니다.
