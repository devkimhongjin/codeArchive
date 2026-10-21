# CodeArchive

CodeArchive는 SWEA·프로그래머스·정올에서 통과한 본인 풀이를 자동으로 기록하는 Chrome 확장입니다. 확장에 포함된 대시보드에서 풀이를 조회·관리하고, GitHub 저장소에 커밋할 수 있습니다. 별도 PC 앱 없이 Chrome 안에서 사용합니다.

[Chrome 웹스토어](https://chromewebstore.google.com/detail/codearchive/mlhibjadcbklfdllkonhjjajhmhnoalj) · [릴리스](https://github.com/devkimhongjin/codeArchive/releases) · [Issue](https://github.com/devkimhongjin/codeArchive/issues) · [웹스토어 배포 안내](docs/extension-webstore.md)

## 설치와 업데이트

- [Chrome 웹스토어](https://chromewebstore.google.com/detail/codearchive/mlhibjadcbklfdllkonhjjajhmhnoalj)에서 설치합니다(항목 ID `mlhibjadcbklfdllkonhjjajhmhnoalj`). 업데이트는 Chrome이 자동으로 적용합니다.
- 확장 팝업의 **대시보드 열기**에서 GitHub로 로그인하면 이후 정답 제출이 자동으로 서버에 등록됩니다.
- GitHub 자동 커밋을 쓰려면 대시보드의 **GitHub 관리**에서 저장소를 연결합니다. 로그인과 저장소 연결은 별개입니다.
- 버전별 변경 사항은 [`docs/releases`](docs/releases)와 [GitHub 릴리스](https://github.com/devkimhongjin/codeArchive/releases)에 있습니다.

## 주요 기능

| 영역 | 내용 |
| --- | --- |
| 정답 자동 수집 | SWEA·프로그래머스·정올에서 정답이 나오면 제출한 코드·문제·언어·시각·성능(시간·메모리)을 서버에 등록합니다. 사이트 제출 흐름은 막지 않습니다. |
| 끊김 없는 저장 | 서버 연결이나 로그인 확인이 늦어도 정답은 기기 대기열에 먼저 저장하고, 연결되면 자동으로 다시 보냅니다. 브라우저를 다시 열어도 이어서 전송합니다. |
| 확장 팝업 | GitHub 자동 커밋 ON/OFF, 최근 동기화된 문제의 코드 복사·다운로드, 일괄 커밋 진행률, 저장소 바로가기(우측 하단 GitHub 링크) |
| 대시보드 | 문제별 제출 묶음, 검색·플랫폼·언어 필터·정렬, 코드 하이라이트(표시 언어만 불러옴), 테마·파일명·주석 설정 |
| 과거 풀이 수집 | 사이트의 내 제출 내역에서 정답 후보를 찾아 원본을 확인한 뒤 서버에 등록합니다. 정올은 확장이 제출현황을 백그라운드 탭에서 직접 열고 닫으며, 창 크기와 무관하게 동작합니다. |
| GitHub 연동 | 개인 GitHub App 설치, 저장소·브랜치·폴더 선택, 파일명·커밋 메시지 템플릿, 신규 풀이 자동 커밋, 과거 풀이 일괄 커밋 |
| 저장소 관리 | 파일·폴더 트리 조회, 빈 저장소 초기화, 파일·폴더 추가, 이동·삭제 미리보기 후 커밋 |
| 커뮤니티 | 본인이 공개한 문제에 한해 다른 사용자의 공개 풀이 탐색. 신규 풀이 기본 공개 여부는 계정 설정에서 선택 |
| 문의·오류 제보 | 로그인한 사용자의 비공개 문의와 관리자 답변. [보관·권한 안내](docs/support-inquiries.md) |

- 서버 목록·과거 수집·커뮤니티·GitHub 기능에는 로그인이 필요합니다.
- Chrome을 완전히 종료하면 확장 작업은 멈추고, 다시 열면 이어서 처리합니다. 서버에 접수된 GitHub 커밋 작업은 서버가 처리합니다.
- 성능 수치는 각 플랫폼이 표시하는 값입니다. 프로그래머스는 테스트별 시간 합계와 메모리 평균을 쓰므로 SWEA·정올과 측정 기준이 다릅니다. 단위를 알 수 없는 이전 메모리는 **단위 미확인**으로 표시합니다.

## 동작 방식

```text
사이트에서 정답 확인 → 기기 대기열에 저장 → 인증된 API 서버에 등록(실패 시 자동 재전송)
  ├─ 팝업·대시보드: 서버 기록 조회·복사·다운로드
  ├─ 과거 수집: 서버 기록으로 중복 제외 → 원본 확인 후 서버 등록 → GitHub 일괄 커밋
  └─ GitHub 자동 커밋 ON: API 작업 큐 → Worker → 선택한 저장소
```

- 풀이 코드는 서버 등록이 확인될 때까지만 기기 대기열에 보관하고, 등록되면 대기열에서 지웁니다.
- 확장에는 GitHub OAuth·App 토큰을 보관하지 않고, 풀이 전송용 제한 grant만 보관합니다. grant가 비거나 만료되면 Chrome의 로그인 쿠키로 다시 발급받습니다.
- 결과를 확정할 수 없는 `UNKNOWN` 커밋은 자동으로 다시 시도하지 않고, 저장소 상태와 대조한 뒤 처리합니다.

## 구성

| 경로 | 역할 | 기술 |
| --- | --- | --- |
| `apps/extension` | 제출 감지, 대기열·서버 등록, 팝업, 과거 수집, 백그라운드 일괄 커밋 | TypeScript, Chrome MV3, IndexedDB |
| `apps/dashboard` | 확장에 포함되는 대시보드(풀이 탐색, 설정, GitHub 연동, 커뮤니티) | React, TypeScript, Vite, Shiki |
| `apps/api` | 인증, 풀이·설정 저장, Relay, GitHub 작업 | Java 17, Spring Boot 3.5, Spring Security, JPA, Maven |
| `shared` | 언어·테마·API 주소·빌드 정보 | TypeScript |
| `infra/gcp` | Cloud Run·Cloud Tasks 배포와 DB 사전 검사 | PowerShell, Node.js |

서버 데이터와 세션은 PostgreSQL에 저장하며 Flyway로 스키마를 관리합니다. 로컬 개발에서는 파일 기반 H2를 쓸 수 있습니다. 이전 PC 앱은 더 이상 개발하지 않으며, 기존 버전 안내는 [PC 앱 문서](docs/desktop-app.md)에 있습니다.

## 로컬 개발

Node.js 22.12 이상, JDK 17 이상, Chrome 120 이상이 필요합니다. 명령은 저장소 루트에서 실행합니다.

```powershell
npm run setup   # 대시보드·확장 의존성 설치
npm run build   # 대시보드 → 확장 순서로 빌드
npm run dev     # 대시보드 개발 서버 (http://localhost:5173)
```

API는 별도 터미널에서 실행합니다. `local` 프로필의 H2 데이터는 `apps/api/data`에 저장되고, 대시보드 개발 서버의 `/api` 요청은 `localhost:8080`으로 전달됩니다.

```powershell
cd apps/api
# JAVA_HOME이 JDK 17 이상을 가리켜야 합니다. macOS/Linux에서는 ./mvnw
./mvnw.cmd spring-boot:run "-Dspring-boot.run.profiles=local"
```

### 확장 로드

1. `npm run build`로 빌드합니다.
2. `chrome://extensions`에서 개발자 모드를 켜고 **압축해제된 확장 프로그램을 로드합니다**로 `apps/extension/dist`를 선택합니다.
3. 개발용 고정 ID `oohlcmihldmfninmdcmanddfmhoonmdl`을 확인하고, 문제 페이지를 새로 엽니다.
4. 팝업의 **대시보드 열기**로 로그인합니다.

- 개발용 확장과 웹스토어 확장은 ID가 달라 로그인과 기기 데이터가 서로 공유되지 않습니다.
- 업데이트할 때는 확장을 삭제하지 말고 같은 폴더의 빌드를 교체한 뒤 새로고침(↻)합니다. 삭제하면 기기 대기열에 남은 풀이가 사라질 수 있습니다.
- 이미 로드한 다른 압축 해제 폴더를 쓰려면 `apps/extension/build.local.json`으로 출력 경로를 지정합니다. 개인 경로는 커밋하지 않습니다.

### GitHub 로그인

GitHub OAuth App에 콜백 URL `http://localhost:5173/api/login/oauth2/code/github`를 등록하고, **API를 실행할 터미널에서** 설정합니다.

```powershell
$env:GITHUB_CLIENT_ID = 'your-client-id'
$env:GITHUB_CLIENT_SECRET = 'your-client-secret'
$env:GITHUB_REDIRECT_URI = 'http://localhost:5173/api/login/oauth2/code/github'
$env:DASHBOARD_ORIGIN = 'http://localhost:5173'
```

- 자격증명이 없으면 GitHub 로그인이 비활성화됩니다. 이메일·비밀번호 가입은 제공하지 않습니다.
- 로컬 설정은 Git에서 제외된 `apps/api/config/application-local.properties`에 둘 수 있습니다. 비밀값은 공유하거나 커밋하지 않습니다.
- 자동 커밋 개발에는 `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`가 추가로 필요합니다. 설치 콜백 절차는 [API 문서](apps/api/README.md#github-app-installation-callback)를 참고하세요.

### PostgreSQL

H2 대신 개발용 PostgreSQL을 쓰려면 다음을 실행합니다.

```powershell
$env:POSTGRES_PASSWORD = 'choose-your-local-password'
docker compose up -d postgres
$env:DB_USERNAME = 'codearchive'
$env:DB_PASSWORD = $env:POSTGRES_PASSWORD
$env:DATABASE_URL = 'jdbc:postgresql://localhost:5432/codearchive'
cd apps/api
./mvnw.cmd spring-boot:run
```

Flyway를 적용한 뒤 Hibernate로 스키마를 검증하며, `prod` 프로필은 `codearchive_v2` 스키마를 씁니다. 마이그레이션 목록은 [`db/migration`](apps/api/src/main/resources/db/migration)에 있습니다. 운영 DB에 적용할 때의 백업·비교·baseline 절차는 [마이그레이션 문서](apps/api/docs/database-migrations.md)를 따릅니다.

## 테스트

```powershell
npm test                 # 대시보드·확장 테스트(타입 검사 포함)
npm run build
cd apps/api; ./mvnw.cmd test   # API 테스트(H2, 외부 응답은 모의)
```

- PostgreSQL 환경 변수가 없으면 PostgreSQL 전용 테스트는 건너뜁니다. Docker와 JDK가 있으면 `./scripts/test-postgres.ps1`로 임시 PostgreSQL 17 마이그레이션을 검증할 수 있습니다.
- GCP 배포 사전 검사: `node --test infra/gcp/staging-db-preflight.test.mjs`
- [Verify 워크플로](.github/workflows/verify.yml)가 클라이언트 테스트·빌드, API·PostgreSQL 마이그레이션, 배포 사전 검사를 실행합니다. 자동 테스트 통과가 실제 사이트 제출·로그인·GitHub 쓰기·스토어 설치본 동작을 보증하지는 않으며, 실제 확인 항목은 [#456](https://github.com/devkimhongjin/codeArchive/issues/456)에서 관리합니다.

## 릴리스와 배포

1. 구현 PR은 `develop`을 대상으로 합니다. 릴리스는 버전과 릴리스 노트(`docs/releases/extension-vX.Y.Z.md`)를 올린 뒤 `develop`을 `master`로 승격합니다.
2. `master`에서 `Extension package` 워크플로로 `extension-vX.Y.Z` 태그와 GitHub 릴리스를 만듭니다.
3. `Chrome Web Store release` 워크플로로 심사를 제출합니다. `STAGED_PUBLISH`로 제출하므로 심사를 통과해도 자동 공개되지 않고, Developer Dashboard에서 직접 게시해야 합니다(심사 완료 후 30일 안). 다른 버전이 심사 중이면 제출하지 않습니다.
4. 백엔드 변경은 공개 중인 스토어 버전과의 호환성을 먼저 확인합니다. 호환되지 않으면 새 확장을 게시한 직후 `Deploy GCP Staging`으로 배포합니다. 자세한 순서는 [웹스토어 배포 안내](docs/extension-webstore.md)에 있습니다.

## 보안 경계

- 확장은 고정 Cloud Run API origin에만 접속합니다. 스토어 빌드의 host 권한은 SWEA·프로그래머스·정올·API 네 곳이고, 외부 웹 페이지 연결(`externally_connectable`)이 없어 어떤 웹 페이지도 확장에 메시지를 보낼 수 없습니다. 레거시 Netlify 대시보드는 제거했습니다(#462).
- 외부 웹 브리지는 로컬 개발용 `http://localhost:5173`에서만 연결할 수 있습니다. 다른 포트·`127.0.0.1`·유사 도메인은 허용하지 않습니다.
- 계정은 GitHub 고유 ID로 구분하며, 서버가 계정별 데이터 접근과 설정 변경을 검사합니다.
- 문제 본문 전체·공식 해설·비공개 테스트 데이터·플랫폼 로그인 정보는 저장하지 않습니다. 소스 코드와 비밀값은 로그에 남기지 않습니다.
- [GCP 배포 구성](infra/gcp/README.md)은 공개 API와 비공개 GitHub worker, Cloud Tasks OIDC 호출을 분리합니다. 내부 worker endpoint는 비공개 서비스에서만 활성화합니다.

## 남은 작업

- 정올·SWEA·프로그래머스의 화면 변경에 맞춘 실제 제출 검증을 계속합니다([#456](https://github.com/devkimhongjin/codeArchive/issues/456)).
- AGENTS.md와 설계 문서를 확장 단독 구조로 갱신합니다([#460](https://github.com/devkimhongjin/codeArchive/issues/460)).
- 커뮤니티의 기존 풀이 공개 전환과 사용자 검증은 [#364](https://github.com/devkimhongjin/codeArchive/issues/364), [#365](https://github.com/devkimhongjin/codeArchive/issues/365)에서 다룹니다.
- 정적 분석은 캐시 식별자 기반 코드만 있으며, 분석 실행과 사용자 기능은 후속 범위입니다.
