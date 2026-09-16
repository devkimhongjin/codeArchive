# CodeArchive

SWEA와 Programmers의 통과한 풀이를 로컬에 보관하고 개인 대시보드로 동기화하는 서비스의 1차 구현입니다.

## 구성

| 디렉터리 | 역할 | 기술 |
| --- | --- | --- |
| apps/extension | 제출 감지, 로컬 보관, Dashboard 연결 | TypeScript, Chrome MV3, IndexedDB |
| apps/dashboard | 계정, 풀이 목록·검색·코드 상세, 수동 동기화 | React, TypeScript, Vite |
| apps/api | 세션 인증, 사용자별 풀이, Bulk 저장 | Java 17+, Spring Boot, JPA |
| docs | 구조, 검증 범위, 후속 개발 | Markdown |

UI는 [CodeArchive Figma](https://www.figma.com/design/MjmogsVNXfKIxuGbJ8btWh/CodeArchive-Dashboard-Archive-UI?node-id=5-2)를 참고합니다. 데모 화면의 풀이 데이터는 실제 계정 데이터와 구분됩니다.

## 로컬 실행

Node.js 22.12+와 Java 17 이상이 필요합니다. 아래 명령은 저장소 루트에서 실행합니다.

```powershell
npm run setup
npm run build
npm run dev
```

Dashboard 주소는 http://localhost:5173 입니다. 별도 터미널에서 API를 실행하세요.

```powershell
cd apps/api
# JAVA_HOME이 Java 17 이상의 JDK를 가리켜야 합니다.
./mvnw.cmd spring-boot:run "-Dspring-boot.run.profiles=local"
```

macOS/Linux에서는 ./mvnw를 사용합니다. 로컬 프로필은 파일 기반 H2 DB를 사용합니다. Dashboard의 /api 요청은 Vite 프록시를 통해 localhost:8080으로 전달됩니다. 로그인은 GitHub 전용이며 이메일·비밀번호 가입은 제공하지 않습니다.

### GitHub 로그인 설정

GitHub OAuth App의 콜백 URL을 `http://localhost:5173/api/login/oauth2/code/github`로 등록하고 API 프로세스에 아래 환경 변수를 설정합니다. Client Secret은 서버에서만 사용합니다.

```powershell
$env:GITHUB_CLIENT_ID = 'your-client-id'
$env:GITHUB_CLIENT_SECRET = 'your-client-secret'
$env:GITHUB_REDIRECT_URI = 'http://localhost:5173/api/login/oauth2/code/github'
$env:DASHBOARD_ORIGIN = 'http://localhost:5173'
```

설정이 없으면 데모 화면과 서버는 실행할 수 있지만 GitHub 로그인은 비활성으로 표시됩니다. 계정 식별은 GitHub 고유 ID를 사용하며 기존 로컬 계정을 이메일로 자동 병합하지 않습니다. 로그인 권한과 GitHub 저장소 커밋 권한은 별도입니다.

이 PC의 재사용 OAuth 설정은 Git에서 제외된 `apps/api/config/application-local.properties`에 보관합니다. `apps/api` 디렉터리에서 `local` 프로필로 API를 실행하면 자동으로 읽습니다. 이 파일에는 비밀값이 있으므로 공유하거나 커밋하지 않습니다.

### 확장 프로그램

1. npm run build로 확장 프로그램을 빌드합니다.
2. Chrome의 chrome://extensions에서 개발자 모드를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**에서 apps/extension/dist를 선택합니다.
4. GitHub로 로그인하면 고정 ID의 확장 프로그램에 자동 연결합니다.
5. 지금 동기화를 눌러 저장된 Capture를 가져옵니다. 이전 개발 ID의 기록은 설정의 이전 개발 기록 확인에서 가져올 수 있습니다.

확장 프로그램 연결 허용 origin은 정확히 `http://localhost:5173`와 운영
`https://codearchive-dashboard-beta.netlify.app`입니다. 127.0.0.1, 다른 포트,
lookalike 도메인, 또는 로컬/운영 sender-tab 혼합은 연결되지 않습니다.

### 운영 배포

Render API는 `apps/api/Dockerfile`을 Docker context `apps/api`로 빌드합니다.
`prod` 프로필은 `$PORT`(기본 8080)로 실행하고 `/actuator/health`를 제공합니다.
`DATABASE_URL`(JDBC PostgreSQL URL), `DB_USERNAME`, `DB_PASSWORD`, GitHub OAuth
값과 정확한 production origin 값은 배포 환경에서 설정합니다. Netlify는
`apps/dashboard/dist`를 배포하며 `/api/*`를 Render API로 same-origin 프록시하므로
OAuth callback은 `https://codearchive-dashboard-beta.netlify.app/api/login/oauth2/code/github`입니다.

### PostgreSQL

개발용 PostgreSQL 컨테이너를 사용하는 경우:

```powershell
$env:POSTGRES_PASSWORD = 'choose-your-local-password'
docker compose up -d postgres
$env:DB_USERNAME = 'codearchive'
$env:DB_PASSWORD = $env:POSTGRES_PASSWORD
$env:DATABASE_URL = 'jdbc:postgresql://localhost:5432/codearchive'
cd apps/api
./mvnw.cmd spring-boot:run
```

PostgreSQL 스키마는 Flyway 버전별 SQL로 생성·변경하고 Hibernate는 엔티티와의 일치 여부를 검증합니다. 기존 PostgreSQL DB를 도입할 때는 백업과 스키마 확인 후 명시적으로 baseline을 지정해야 합니다. 자동 baseline은 사용하지 않습니다. 절차는 `apps/api/docs/database-migrations.md`를 참고하세요. 로컬 H2 프로필의 기존 데이터 보관 방식은 유지합니다.

Docker와 JDK가 준비되어 있으면 별도 임시 PostgreSQL 17에서 마이그레이션 테스트를 실행할 수 있습니다. 테스트가 만든 컨테이너는 실행 후 정리됩니다.

```powershell
./scripts/test-postgres.ps1
```

## 검증 명령

```powershell
npm run build
npm run test:extension
cd apps/api
./mvnw.cmd test
```

## 현재 경계

- 플랫폼 Adapter는 기존 `devkimhongjin/codeArchive`의 제출 검증 방식을 참고합니다. 출처와 선택자는 `docs/reference-submission-verification.md`에 기록했습니다. 현재 서비스 DOM 호환성은 실브라우저 제출 검증이 필요합니다.
- Dashboard가 닫혀 있으면 로컬 보관만 지속하며 서버 전달은 재연결 후 수행합니다.
- GitHub App 연동, 실제 커밋, 자동 커밋 Worker와 별도 Relay는 후속 개발 대상입니다.
- 개발 변경은 GitHub의 기능 브랜치에서 PR을 열어 develop에 병합합니다. master 반영과 배포는 별도 승인 대상입니다. 이번 신규 구축 전환 범위와 후속 작업은 docs/rebuild-handoff.md를 참고하세요.

자세한 내용은 docs/architecture.md, docs/validation-matrix.md, docs/roadmap.md를 참고하세요.
