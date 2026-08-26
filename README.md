# CodeArchive

CodeArchive는 코딩테스트 풀이를 자동으로 수집하고 로컬에 안전하게 보관한 뒤, 서버 동기화와 AI 보조 기능으로 확장하는 **local-first 풀이 아카이브**입니다.

현재 목표는 약 20명이 사용할 수 있는 SWEA 베타입니다.

```text
GitHub 로그인
→ SWEA PASS 감지
→ Extension IndexedDB 자동 저장
→ 인증된 Main API 동기화
→ 사용자별 PostgreSQL 영구 저장
→ AI 보조 결과 생성·조회
```

로그인, API, 데이터베이스 또는 분석 서비스가 사용할 수 없는 상황에서도 로컬 저장·조회·수정·내보내기·삭제 기능은 계속 동작해야 합니다.

## 현재 베타 상태

- Main API: `https://codearchive-api.onrender.com`
- Analysis API: `https://codearchive-analysis.onrender.com`
- 안정화된 Extension ID: `oohlcmihldmfninmdcmanddfmhoonmdl`
- Extension Main API 권한: `https://codearchive-api.onrender.com/*`만 허용
- PostgreSQL: Neon, Flyway V1–V5 적용
- Analysis provider: `fake`
- live OpenAI: 비활성화
- Render 서비스: Free 플랜, 자동 배포 비활성화

Main API와 Analysis API health, Analysis 내부 API의 미인증 `401`, GitHub 로그인 시작 URL 생성까지 확인했습니다. 실제 unpacked Chrome에서 OAuth 복귀·일회용 코드 교환·인증된 `/api/v1/me` 검증은 [Issue #66](https://github.com/devkimhongjin/codeArchive/issues/66)의 남은 작업입니다.

## 저장소 구성

| 경로 | 역할 |
| --- | --- |
| `apps/extension` | React, TypeScript, Vite 기반 Manifest V3 Chrome Extension |
| `apps/web` | 향후 React 대시보드 |
| `apps/api` | Java 21, Spring Boot 3.5.16 Main API |
| `apps/analysis` | Python, FastAPI 분석 서비스 |
| `packages/shared-types` | 공통 TypeScript 모델과 enum |
| `infra` | 로컬 Compose와 Render 베타 Blueprint |
| `.github/agents` | 역할별 멀티에이전트 프로필 |
| `plugins/codearchive-workflows` | ChatGPT Work용 CodeArchive 역할 Skill |

## 개발 환경

- Node.js 20 이상
- pnpm 10.15.0
- Java 21
- Python 3.12
- Docker Compose

### TypeScript / Extension

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @codearchive/extension typecheck
pnpm --filter @codearchive/extension test
pnpm --filter @codearchive/extension build
```

빌드 결과는 `apps/extension/dist`에 생성됩니다. Chrome의 `chrome://extensions`에서 개발자 모드를 켠 뒤 **압축해제된 확장 프로그램을 로드합니다**로 해당 폴더를 선택합니다.

### Main API

```bash
cd apps/api
export DB_PASSWORD=change-me
./gradlew test
./gradlew bootRun
```

Windows PowerShell에서는 `$env:DB_PASSWORD="change-me"`를 설정하고 `./gradlew.bat`을 사용할 수 있습니다. 로컬 GitHub OAuth 값과 데이터베이스 연결 정보는 `apps/api/.env.example`을 참고하되, 실제 secret은 커밋하지 않습니다.

### Analysis API

```bash
cd apps/analysis
python -m pip install -r requirements.txt
python -m pytest
uvicorn app.main:app --reload --port 8000
```

기본 개발·베타 provider는 `fake`입니다. `OPENAI_API_KEY` 설정과 live OpenAI 활성화는 별도 승인 없이는 수행하지 않습니다.

### 로컬 인프라

```bash
cp infra/.env.example infra/.env
pnpm infra:up
pnpm infra:ps
pnpm infra:down
```

비밀번호와 토큰이 포함된 `infra/.env`는 저장소에 커밋하지 않습니다.

## 브랜치와 배포 정책

```text
feature/*, fix/*, chore/*
→ develop 대상 Pull Request
→ CI와 독립 리뷰
→ 같은 저장소의 develop → master release Pull Request
→ 병합 직전 사용자 승인
→ master 병합
→ 배포 직전 별도 사용자 승인
→ master의 정확한 commit을 수동 배포
→ smoke 검증
```

- `develop`: 통합 개발 브랜치
- `master`: 배포 가능한 브랜치
- `master`에 직접 기능을 개발하거나 직접 push하지 않습니다.
- Render 자동 배포는 계속 비활성화합니다.
- release 병합 승인은 배포 승인을 대신하지 않습니다.
- `master` 대상 PR은 `Master Release Source / require-develop` 검사를 필수로 사용합니다.

세부 정책은 [Issue #67](https://github.com/devkimhongjin/codeArchive/issues/67)과 [작업 Skill 워크플로](docs/work-skill-workflow.md)를 따릅니다.

## 멀티에이전트 작업 방식

CodeArchive는 `.github/agents`의 기존 5개 역할을 사용합니다.

| 역할 | 책임 |
| --- | --- |
| `project-integrator` | 계획, 공유 계약, 이슈·PR 인계, 최종 통합과 승인 게이트 |
| `client-builder` | `apps/extension/**`, `apps/web/**` |
| `service-builder` | `apps/api/**`, `apps/analysis/**`, `infra/**` |
| `quality-reviewer` | 독립적인 정확성·보안·운영 검토, 기본적으로 읽기 전용 |
| `repo-maintainer` | 명시적으로 할당된 기계적·가역적 작업 |

두 에이전트가 같은 경로를 동시에 수정하지 않습니다. 범위, 경로 소유권, 계약 변경, 실제 검사 결과, 위험과 후속 작업은 GitHub Issue와 PR에 남깁니다. 대화보다 GitHub 상태를 우선합니다.

ChatGPT Work에서는 한 대화에 CodeArchive 역할 Skill 하나만 명시적으로 선택합니다. 자세한 내용은 [에이전트 구조](docs/agent-architecture.md), [저장소 에이전트 규칙](AGENTS.md), [작업 Skill 워크플로](docs/work-skill-workflow.md)를 참고하세요.

## 보안 및 범위 제한

- OAuth secret, API key, token, cookie와 전체 사용자 코드를 로그·Issue·PR에 남기지 않습니다.
- 로그인 단계에서 GitHub repository 권한을 요청하지 않습니다.
- Extension 권한은 승인된 정확한 Main API origin 이상으로 넓히지 않습니다.
- live AI, 유료 인프라, 외부 업로드와 권한 확대는 명시적인 승인 없이는 진행하지 않습니다.
- 문제 본문 전체, 공식 해설, 비공개 테스트 데이터와 플랫폼 로그인 정보는 수집하지 않습니다.

## 문서

- [개발 명세서](docs/codearchive-development-spec.md)
- [에이전트 구조](docs/agent-architecture.md)
- [저장소 에이전트 규칙](AGENTS.md)
- [ChatGPT Work Skill 워크플로](docs/work-skill-workflow.md)
- [배포 베타 검증 Issue #37](https://github.com/devkimhongjin/codeArchive/issues/37)
