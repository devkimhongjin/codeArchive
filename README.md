# CodeArchive

CodeArchive는 Chrome Extension으로 코딩테스트 정답 풀이를 자동 수집해 로컬에 보관하고, Web Dashboard에서 로그인·자동 동기화·관리·AI 기능을 제공하는 **local-first 풀이 아카이브**입니다.

현재 목표는 약 20명이 사용할 수 있는 SWEA 베타입니다.

## 처음 사용하는 분께

**출시 전 초대형 베타입니다.** 설치 후보와 가이드는 준비되어 있어도 실제 두 계정 동기화·데이터 보존 검증까지 끝난 정식 배포본은 아닙니다. 운영자가 사용 가능하다고 확인한 패키지만 설치하고, 중요한 원본 코드는 별도로 보관하세요.

- [웹 Dashboard 열기](https://codearchive-dashboard-beta.onrender.com)
- [설치·업데이트 안내](docs/beta-install.md) — 처음 설치하는 분과 기존 사용자의 절차가 다릅니다.
- [사용 가이드](docs/dashboard-beta-tester-guide.md) — 수집 → 로그인 → 동기화 → 풀이 관리
- [문제 해결·오류 제보](docs/beta-troubleshooting.md)

테스터는 Node.js·Java·Docker를 설치하거나 이 저장소를 빌드할 필요가 없습니다. 운영자에게 **Extension ZIP, SHA-256 확인값, 테스트 안내**를 받으면 됩니다. GitHub의 `Code → Download ZIP`은 소스 코드이며 설치용 패키지가 아닙니다. 아직 확정된 공개 다운로드 링크는 없습니다.

### 빠른 시작

1. 받은 ZIP을 압축 해제하고 Chrome에서 그 안의 `extension` 폴더를 로드합니다. [자세한 설치 순서](docs/beta-install.md)
2. 본인 소유의 테스트 풀이를 SWEA에서 정답 제출하고 팝업의 **로컬 풀이 보기**에서 저장을 확인합니다.
3. **전체 풀이 보기**로 Dashboard를 열고 초대 비밀번호를 한 번 입력한 뒤 **GitHub로 로그인**합니다. 계정과 **Extension 연결됨** 상태를 확인합니다.
4. 전송할 대기 기록을 먼저 확인한 뒤 **자동 동기화**를 켭니다. 선택한 한 건이 아니라 **대기 중인 기록 전체가 대상**입니다.
5. Dashboard에서 풀이를 찾아 복사·다운로드·수정합니다. AI는 작업별 별도 동의가 필요하며 현재 `fake` 결과는 테스트용입니다.

로그인·동기화를 원하지 않으면 로컬 풀이 보기만 사용할 수 있습니다. Extension을 제거하거나 Chrome 데이터를 지우면 로컬 기록을 잃을 수 있으므로 문제 해결을 위해 재설치부터 하지 마세요.

### 지금 가능한 것과 제한

| 가능한 것 | 현재 제한 |
| --- | --- |
| SWEA 정답 자동 수집, 로컬 조회·편집·풀이별 내보내기 | 다른 플랫폼 자동 수집·실행시간/메모리 자동 수집은 미지원 |
| Dashboard 로그인, 동의 기반 동기화, 서버 풀이 관리 | Dashboard가 닫힌 동안 서버 전송은 멈추고 로컬에 쌓임 |
| AI 접근 방법·주석 코드·리뷰 화면 | 현재 베타 provider는 `fake`, 실제 AI 품질 검증 아님 |
| Source/Markdown 다운로드 | 전체 기록 일괄 백업·완전 복원 UI는 없음 |

GitHub 저장소 업로드, 공개 공유·리더보드, Chrome 웹 스토어 출시는 이번 베타 범위가 아닙니다. 무료 API의 초기 응답이 늦을 수 있습니다.

운영자는 [배포·전달 점검표](docs/beta-distribution-checklist.md)와 [초대 메시지 양식](docs/beta-invite-template.md)을 사용하세요. 문서 준비 완료는 실제 사용자 배포 승인이나 E2E 통과를 대신하지 않습니다.

Dashboard 입장 비밀번호는 같은 탭에서 한 번만 확인하는 간단한 화면 제한입니다. **API 직접 호출이나 사용량을 강제로 차단하는 기능은 아닙니다.** 실제 값은 Main API의 `CODEARCHIVE_BETA_ACCESS_PASSWORD` 비밀 설정(8~128자)에 두며 공개 저장소·프론트엔드 환경 변수·ZIP에는 넣지 않습니다. [동작과 한계](docs/beta-access-design.md)

## 동작 구조

```text
SWEA PASS 감지
→ Extension IndexedDB 자동 저장
→ 연결된 Dashboard에 capture 변경 알림
→ Dashboard가 pending 기록 자동 가져오기
→ Dashboard 세션으로 Main API 저장
→ 사용자별 PostgreSQL 영구 저장
→ AI 보조 결과 생성·조회
```

Dashboard가 닫혀 있거나 로그아웃되어 있어도 Extension의 로컬 수집·조회·수정·내보내기·삭제 기능은 계속 동작합니다. 다음 eligible Dashboard 연결 시 쌓여 있던 pending 기록을 자동으로 따라잡습니다.

목표 구조에서 서버 동기화와 사용자 계정 컨텍스트는 Dashboard가 소유합니다. **현재 전환 버전에는 이전 Extension OAuth·token·직접 API 경로와 권한이 아직 남아 있습니다.** 로그인·서버 동기화·AI는 Dashboard를 사용하며, 잔여 경로는 대체 E2E 통과 후 #86에서 제거합니다.

## 현재 베타 상태와 목표 구조

- Dashboard: [codearchive-dashboard-beta.onrender.com](https://codearchive-dashboard-beta.onrender.com)
- Main API: `https://codearchive-api.onrender.com`
- Analysis API: `https://codearchive-analysis.onrender.com`
- 안정화된 Extension ID: `oohlcmihldmfninmdcmanddfmhoonmdl`
- PostgreSQL: Neon, 스키마 변경은 `apps/api/src/main/resources/db/migration`에서 관리
- Analysis provider: `fake`
- live OpenAI: 비활성화
- provider auto-deploy: 비활성화 유지
- Extension 목표 권한: 기존 `identity`와 Main API `host_permissions` 제거
- Extension ↔ Dashboard: 승인된 exact HTTPS origin의 external messaging bridge만 허용

현재 전환 목표는 기존 Extension OAuth/direct sync를 대체하는 **Dashboard-owned automatic synchronization**입니다. replacement real-Chrome E2E가 통과하기 전에는 legacy 경로를 즉시 삭제하지 않습니다. 세부 설계는 [Extension → Dashboard 자동 동기화 설계](docs/extension-dashboard-handoff-design.md)를 따릅니다.

## 저장소 구성

| 경로 | 역할 |
| --- | --- |
| `apps/extension` | Manifest V3 Chrome Extension: 플랫폼 감지, 정답 코드 capture, IndexedDB, local export, Dashboard bridge |
| `apps/web` | React Dashboard: 로그인, 자동 동기화, 서버 기록 관리, AI/외부 연동 |
| `apps/api` | Java 21, Spring Boot 3.5.16 Main API |
| `apps/analysis` | Python, FastAPI 분석 서비스 |
| `packages/shared-types` | 공통 capture/import/API 계약 |
| `infra` | 로컬 Compose와 배포 구성 |
| `.github/agents` | 역할별 멀티에이전트 프로필 |
| `plugins/codearchive-workflows` | ChatGPT Work용 CodeArchive 역할 Skill |

## 자동 동기화 원칙

자동 동기화는 Extension이 서버로 직접 push하는 구조가 아닙니다.

```text
Extension = capture + local truth + bridge
Dashboard = auth + sync controller + API client
Main API = authenticated durable persistence
```

사용자가 Dashboard에서 자동 동기화를 활성화하고 로그인된 Dashboard가 Extension과 연결되어 있으면:

1. Extension이 SWEA 정답을 capture하고 IndexedDB commit을 완료합니다.
2. Extension은 연결된 Dashboard에 코드가 없는 `capture changed` 신호를 보냅니다.
3. Dashboard가 pending 기록을 page 단위로 pull합니다.
4. Dashboard session으로 Main API bulk upsert를 수행합니다.
5. 성공하거나 동일 사용자 중복으로 확인된 record만 Extension에 acknowledge합니다.

Dashboard가 닫힌 동안에는 네트워크 동기화를 하지 않고 local capture만 유지합니다. Dashboard가 다시 연결되면 pending을 자동으로 catch-up합니다.

로그아웃이나 계정 전환 시 기존 bridge capability를 종료합니다. 새 Dashboard bridge에는 CodeArchive/GitHub 사용자 식별자나 인증 token을 전달하지 않습니다. 이전 Extension 인증 코드 제거 여부는 별도 cleanup 상태를 확인합니다.

## 개발 환경

- Node.js 22 (CI 기준)
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

### 로컬 인프라

Main API를 실행하기 전에 PostgreSQL과 Redis를 시작합니다.

```bash
cp infra/.env.example infra/.env
pnpm infra:up
pnpm infra:ps
```

사용을 마치면 `pnpm infra:down`으로 종료합니다. 비밀번호와 token이 포함된 `infra/.env`는 저장소에 커밋하지 않습니다.

### Main API

```bash
cd apps/api
export DB_PASSWORD=change-me
./gradlew test
./gradlew bootRun
```

Windows PowerShell에서는 `$env:DB_PASSWORD="change-me"`를 설정하고 `./gradlew.bat`을 사용할 수 있습니다. 실제 secret은 커밋하지 않습니다.

### Analysis API

```bash
cd apps/analysis
python -m pip install -r requirements.txt
python -m pytest
uvicorn app.main:app --reload --port 8000
```

기본 개발·베타 provider는 `fake`입니다. `OPENAI_API_KEY` 설정과 live OpenAI 활성화는 별도 승인 없이는 수행하지 않습니다.

## 브랜치와 배포 환경

CodeArchive는 개발/베타와 Production을 분리합니다.

```text
feature/*, fix/*, chore/*
→ develop 대상 PR
→ CI + 독립 리뷰
→ 병합 직전 사용자 승인
→ develop
→ 필요 시 development/beta 배포 승인
→ develop exact commit으로 beta 검증
→ develop → master release PR
→ release merge 직전 사용자 승인
→ master
→ Production 배포 직전 별도 사용자 승인
→ master exact commit Production 배포
```

### `develop`

- 통합 개발 브랜치입니다.
- **development/beta runtime의 배포 소스**입니다.
- 실제 Chrome/E2E와 배포 환경 검증은 필요한 경우 `develop`의 정확한 commit을 배포해 수행합니다.
- 개발/베타 외부 배포도 실행 직전 사용자 승인이 필요합니다.
- `develop` 배포는 Production 승인을 의미하지 않습니다.

### `master`

- **Production release/deployment 전용 브랜치**입니다.
- routine 개발이나 beta 반복 검증에 사용하지 않습니다.
- 같은 저장소의 `develop` → `master` PR로만 승격합니다.
- `Master Release Source / require-develop` 검사를 유지합니다.
- Production을 `develop`에서 직접 배포하지 않습니다.
- release merge 승인과 Production 배포 승인은 별도입니다.

현재 provider 자원이 beta 용도라면 beta 자원으로 유지합니다. 별도 Production 자원 생성/전환, 도메인/비용 변경은 이후 Integrator 설계 및 명시적 승인 대상입니다. Provider auto-deploy는 별도 결정 전까지 비활성 상태를 유지합니다.

## 멀티에이전트 작업 방식

CodeArchive는 `.github/agents`의 5개 역할을 사용합니다.

| 역할 | 책임 |
| --- | --- |
| `project-integrator` | 계획, 공유 계약, 환경 정책, 이슈·PR 인계, 최종 통합과 승인 게이트 |
| `client-builder` | `apps/extension/**`, `apps/web/**` — Extension capture/bridge, Dashboard auth/auto-sync |
| `service-builder` | `apps/api/**`, `apps/analysis/**`, `infra/**` |
| `quality-reviewer` | 독립적인 정확성·보안·개인정보·동의·운영 검토, 기본적으로 읽기 전용 |
| `repo-maintainer` | 명시적으로 할당된 기계적·가역적 작업 |

두 에이전트가 같은 경로를 동시에 수정하지 않습니다. 범위, 경로 소유권, 계약 변경, 실제 검사 결과, 위험, 대상 환경과 후속 작업은 GitHub Issue와 PR에 남깁니다. 대화보다 GitHub 상태를 우선합니다.

ChatGPT Work에서는 한 대화에 CodeArchive 역할 Skill 하나만 명시적으로 선택합니다. 자세한 내용은 [에이전트 구조](docs/agent-architecture.md), [저장소 에이전트 규칙](AGENTS.md), [작업 Skill 워크플로](docs/work-skill-workflow.md)를 참고하세요.

## 보안 및 범위 제한

- OAuth secret, API key, token, cookie와 전체 사용자 코드를 로그·Issue·PR에 남기지 않습니다.
- 새 Dashboard bridge는 사용자 인증 token을 전달·저장하지 않습니다. 이전 Extension 인증 코드·권한은 #86 완료 전까지 잔존합니다.
- 자동 동기화는 Dashboard에서 사용자가 활성화한 authenticated account context에서만 source 전송을 허용합니다.
- Dashboard exact origin을 `externally_connectable`에 추가하는 변경은 브라우저 보안 경계 변경이므로 구현 직전 별도 승인을 받습니다.
- Extension의 legacy `identity`/Main API host permission은 replacement E2E 통과 후 cleanup합니다.
- live AI, 유료 인프라, 외부 업로드와 권한 확대는 명시적인 승인 없이는 진행하지 않습니다.
- 문제 본문 전체, 공식 해설, 비공개 테스트 데이터와 플랫폼 로그인 정보는 수집하지 않습니다.

## 문서

- [설치·업데이트](docs/beta-install.md)
- [베타 사용 가이드](docs/dashboard-beta-tester-guide.md)
- [문제 해결·오류 제보](docs/beta-troubleshooting.md)
- [운영자 배포·전달 점검표](docs/beta-distribution-checklist.md)
- [지인 초대 메시지 양식](docs/beta-invite-template.md)
- [개발 명세서](docs/codearchive-development-spec.md)
- [Extension → Dashboard 자동 동기화 설계](docs/extension-dashboard-handoff-design.md)
- [에이전트 구조](docs/agent-architecture.md)
- [저장소 에이전트 규칙](AGENTS.md)
- [ChatGPT Work Skill 워크플로](docs/work-skill-workflow.md)
