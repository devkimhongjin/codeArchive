# Extension → Dashboard 자동 동기화 설계

## 결정

CodeArchive의 Chrome Extension은 **코딩 플랫폼에서 정답 풀이를 자동 감지하고 로컬 IndexedDB에 보존하는 capture-only 수집기**다.

사용자 인증, 서버 동기화, 기록 관리, AI, GitHub/Notion 등 외부 연동은 Web Dashboard가 전담한다.

Extension은 GitHub OAuth를 시작하지 않고 CodeArchive/GitHub access token 또는 refresh token을 저장하지 않으며 Main API를 직접 호출하지 않는다. Dashboard/API 장애나 로그아웃 상태에서도 수집은 계속되어야 한다.

사용자가 Dashboard에서 자동 동기화를 활성화한 뒤에는 다음 동작을 기본 UX로 한다.

```text
SWEA PASS
→ Extension이 자동 capture
→ IndexedDB 즉시 저장
→ 연결된 Dashboard에 capture 변경 알림
→ Dashboard가 pending record 자동 pull
→ Dashboard session으로 Main API bulk upsert
→ 성공/동일사용자중복 record만 Extension ACK
```

Dashboard가 닫혀 있거나 로그아웃/연결 해제 상태면 서버 전송은 일어나지 않는다. 그동안의 기록은 IndexedDB에 계속 쌓이고, 다음 eligible Dashboard 연결 시 pending 기록을 자동으로 catch-up 한다.

## 책임 경계

| 구성 요소 | 책임 | 금지 사항 |
| --- | --- | --- |
| Extension | 플랫폼 감지, 정답 코드 자동 수집, IndexedDB 로컬 CRUD/내보내기, exact-origin Dashboard bridge, local capture 변경 알림, page/ack 처리, popup의 sanitized automation 상태 표시와 제한된 ON/OFF intent 중계 | OAuth, 사용자 계정 소유권 판단, 백엔드 토큰 저장, Main API 호출, AI·GitHub·Notion 호출, 자동화 권위/동의/대상 판단 |
| Web Dashboard | GitHub 로그인, Extension 연결, 사용자 auto-sync consent, pending 자동 drain, API 저장, 상태/오류 표시, 자동화 authoritative state, GitHub 대상/동의/실행, 기록 관리, AI/외부 연동 | 플랫폼 DOM 직접 수집, Extension 로컬 원본 무단 삭제 |
| Main API | 웹 세션, 사용자별 풀이 idempotent upsert, 중복 방지, 관리/연동 API | Extension을 인증된 사용자 세션으로 간주 |

Extension bridge는 서버 동기화 엔진이 아니다. Extension은 로컬 데이터를 제공하고 ACK receipt를 기록하며 제한된 popup automation intent를 전달할 뿐이다. **어느 사용자 계정으로 언제 서버/GitHub에 저장할지는 Dashboard가 자신의 인증 세션과 동의/대상 상태에서 결정한다.**

## 데이터 흐름

```text
SWEA page
  → Extension content script
  → Extension background validation
  → Extension IndexedDB (authoritative local capture)
  → CAPTURE_CHANGED (metadata only, active Dashboard port가 있을 때)

Signed-in Dashboard + auto-sync enabled
  → exact-origin external Port 연결
  → IMPORT_BEGIN / ephemeral capability
  → pending CAPTURE_PAGE 반복 pull
  → schema validation / optional UI status
  → Main API bulk upsert (Dashboard session)
  ← per-record imported / duplicate / rejected
  → successful-or-same-user-duplicate clientRecordId만 CAPTURE_ACK
  → Extension은 importedAt/importBatchId receipt만 기록
```

Dashboard가 연결되는 순간에도 `pendingCount > 0`이면 신규 이벤트를 기다리지 않고 즉시 catch-up을 시작한다.

## 자동 동기화 사용자 경험

### 최초 활성화

자동 동기화는 사용자 코드가 Dashboard를 통해 서버로 전송되는 기능이므로 **Dashboard가 현재 인증 계정과 동의를 최종 확인한 뒤에만 활성화**한다.

Dashboard는 다음을 표시해야 한다.

- 현재 로그인한 CodeArchive/GitHub 계정
- 연결된 Extension 상태
- 자동 동기화 on/off
- 마지막 성공 동기화 시각
- pending/failed 개수

Extension popup은 OAuth, 계정 선택, Main API/GitHub API 호출 또는 sync engine을 소유하지 않는다. 다만 Issue #159부터 **Dashboard가 발행한 sanitized authoritative automation 상태를 표시하고 `AUTO_SYNC` / `GITHUB_AUTO_COMMIT`의 제한된 ON/OFF intent를 전달하는 UI**는 소유할 수 있다. Popup ON intent 자체는 인증·동의·GitHub 대상 설정을 대체하지 않으며 Dashboard가 필요한 확인을 완료하기 전에는 authoritative ON이 아니다.

### Popup automation control plane (Issue #159)

기존 source-bearing sync data plane(`SYNC_SESSION_START`, `IMPORT_BEGIN`, `CAPTURE_PAGE`, `CAPTURE_ACK`, capability)은 그대로 유지한다. Popup 제어는 같은 exact-origin long-lived Port 위의 **별도 metadata-only control plane**이며 source-bearing capability를 생성하거나 대체하지 않는다.

허용 상태는 shared-types의 정확한 다음 의미만 가진다.

```ts
type CodeArchiveAutomationKind = "AUTO_SYNC" | "GITHUB_AUTO_COMMIT";

type CodeArchiveAutomationControlErrorCode =
  | "AUTH_REQUIRED"
  | "DASHBOARD_DISCONNECTED"
  | "MULTIPLE_DASHBOARD_TABS"
  | "AUTO_SYNC_CONSENT_REQUIRED"
  | "GITHUB_TARGET_REQUIRED"
  | "GITHUB_CONSENT_REQUIRED"
  | "PUBLIC_REPOSITORY_CONSENT_REQUIRED"
  | "OFFLINE"
  | "LEASE_FAILED"
  | "GITHUB_TARGET_CHANGED"
  | "GITHUB_OUTCOME_UNKNOWN"
  | "CONTROL_UNAVAILABLE";

interface CodeArchiveAutomationState {
  protocolVersion: 1;
  autoSyncEnabled: boolean;
  githubAutoCommitEnabled: boolean;
  githubTargetConfigured: boolean;
  authenticated: boolean;
  connectionAvailable: boolean;
  errorCode: CodeArchiveAutomationControlErrorCode | null;
}
```

Control plane에는 다음을 절대 싣지 않는다.

- CodeArchive/GitHub user/account ID 또는 계정명/login;
- GitHub installation/repository ID, owner/name, repository/branch/folder 이름;
- token, cookie, OAuth state/code, capability;
- source/code/title/problem URL 또는 capture record;
- provider/API raw body, raw exception, 자유 형식 오류 문자열.

사용자 안내는 각 client가 고정 `errorCode`를 고정 문구로 매핑한다. Extension은 authoritative automation 상태를 IndexedDB/localStorage 등에 영구 저장하지 않고 background memory에만 cache한다. Extension service worker restart 또는 Dashboard Port disconnect 후에는 cached 상태를 unavailable/default-safe로 취급하고 단일 eligible Dashboard가 다시 상태를 발행해야 한다.

외부 Port의 방향별 control message는 source data plane과 별도 union으로 고정한다.

```ts
// Extension -> Dashboard
CODEARCHIVE_AUTOMATION_STATE_REQUEST
CODEARCHIVE_AUTOMATION_SET_REQUEST { automation, enabled }
CODEARCHIVE_AUTOMATION_SAFETY_STOP { errorCode: "MULTIPLE_DASHBOARD_TABS" }

// Dashboard -> Extension
CODEARCHIVE_AUTOMATION_STATE_UPDATE { state }
```

Popup ↔ Extension background 내부 메시지는 Extension-only 구현 계약으로 두며 external Port/shared source data plane과 혼합하지 않는다.

```text
CODEARCHIVE_POPUP_AUTOMATION_STATE_GET
CODEARCHIVE_POPUP_AUTOMATION_SET { automation, enabled }
```

#### Auto-sync intent

- ON은 현재 Dashboard 인증, exact origin, 단일 Port, Extension 연결, 현재 계정의 명시적 auto-sync consent, online/usable 상태를 모두 다시 확인해야 한다.
- Popup ON 당시 consent가 없으면 authoritative state는 OFF를 유지하고 `AUTO_SYNC_CONSENT_REQUIRED`를 발행한다. 동의 UI/판단은 Dashboard가 소유한다.
- OFF는 새 pending drain을 즉시 ineligible로 만들고 진행 중 drain을 invalidate하며, 가능한 경우 `SYNC_SESSION_END`/Port capability teardown을 먼저 수행한다.
- 명시적 OFF는 Issue #128의 같은 계정 auto-sync opt-in 복원 값을 해제한다.
- OFF 이후 capture는 local IndexedDB에 계속 남으며 다음 명시적 eligible ON 전에는 Main API/GitHub로 자동 전송하지 않는다.

#### GitHub auto-commit intent

- ON은 auto-sync authoritative ON, 인증/단일 Port/online, Dashboard에 이미 설정된 GitHub installation/repository/branch/folder target, 기존 automatic transfer/visibility consent, public repository인 경우 public disclosure consent가 모두 필요하다.
- Popup은 target 값 자체를 받지 않으며 `githubTargetConfigured` boolean만 받는다.
- Dashboard는 ON 직전에 GitHub에서 현재 target을 다시 확인하고 최신 branch HEAD를 refresh해 expected HEAD로 사용해야 한다.
- OFF는 client tick을 중단하고 active run이 있으면 기존 server `autoStop` 계약을 사용한다. 이미 dispatch된 mutation은 완료될 수 있으며 회수할 수 없다.
- `UNKNOWN`/불확실 provider 결과, target/HEAD/ownership/privacy/protection 변화, lease 실패는 자동 실행을 멈추며 자동 재전송하지 않는다.

#### Background Dashboard tab

`document.hidden` 또는 background-tab 상태만으로 auto-sync/GitHub auto-commit을 중단하지 않는다. Dashboard page가 살아 있고 exact-origin Port, 인증, consent, target, online, lease 등 나머지 eligibility가 유효하면 background에서도 계속 동작할 수 있다.

다음은 여전히 즉시 중단 조건이다.

- tab close, `pagehide`, 다른 주소로 navigation;
- logout/session expiry/account change;
- Extension Port disconnect;
- offline;
- multiple Dashboard tabs;
- 사용자의 auto-sync/GitHub auto-commit OFF;
- GitHub target conflict/change;
- server lease expiry/failure;
- GitHub 결과 불확실/UNKNOWN.

브라우저 background timer throttling을 우회하기 위해 lease 또는 no-retry 안전장치를 약화하지 않는다. 현재 GitHub auto-commit 60초 lease가 정상 background Chrome에서 유지되는지는 Real Chrome E2E에서 최소 한 번의 lease renewal/tick 주기로 검증한다. 실패하면 client가 안전 OFF하고 별도 Service Builder 설계로 escalation한다.

#### Multiple Dashboard tabs — fail closed

Extension이 exact-origin Dashboard Port를 2개 이상 감지하면 어느 tab도 임의로 authoritative로 선택하지 않는다.

1. popup control 요청을 어느 tab에도 임의 routing하지 않는다.
2. automatic source-transfer capability/session을 fail-closed로 폐기한다.
3. 연결된 Dashboard들에 `MULTIPLE_DASHBOARD_TABS` safety stop을 전달한다.
4. Dashboard는 pending drain을 invalidate하고 active GitHub auto-run을 stop한다.
5. Extension에는 두 automation을 OFF로 표시하는 sanitized state와 고정 오류 안내만 남긴다.
6. extra tab이 사라져도 자동 재개하지 않는다. 사용자가 conflict를 해결한 뒤 명시적으로 다시 ON해야 한다.

### 같은 브라우저·계정의 동의 복원 (Issue #128)

사용자 승인에 따라 Dashboard 새로고침·재진입 때 **이미 명시적으로 활성화한 동일 계정의 동의만** 복원한다. 로그인 성공 자체는 여전히 동의가 아니다.

- 복원 전 현재 `/api/v1/me`의 인증 성공과 불변 CodeArchive 계정 UUID를 검증한다. 변경 가능한 GitHub 로그인 이름은 동의 결합 키로 사용하지 않는다.
- Web-local 저장값은 버전, 불변 UUID로부터 만든 SHA-256 계정 결합값, 동의 여부로 제한한다. 원본 계정 ID·프로필·토큰·쿠키·OAuth 값·소스·capability는 저장하지 않는다. 이 결합값은 인증 자격 증명이 아닌 설정값이며 bridge로 전송하지 않는다.
- 한 브라우저에는 하나의 현재 계정 동의만 기억한다. 기존 계정 구분 없는 boolean은 승계하지 않는다. 계정 불일치, 확인된 로그아웃/세션 만료, 명시적 로그아웃 시도, 계정 전환, 동의 철회 시 과거 동의를 해제한다.
- 일시적인 인증 확인 실패에서는 자동 전송을 금지한다. 불변 ID·암호화·저장소가 없거나 유효하지 않으면 저장된 동의를 복원하지 않는다. 저장이 불가능해도 현재 인증된 화면에서 새로 명시한 메모리 내 동의는 사용할 수 있다.
- 다른 탭의 동의 철회·로그아웃·저장값 무효화는 기존 메모리 동의와 drain을 중단시킨다. 늦게 완료되는 인증/해시/복원 결과가 철회된 동의를 되살려서는 안 된다.
- 저장소를 사용할 수 없거나 저장된 동의 키가 없는 메모리 전용 모드에서는 재진입 복원과 타탭 해제 통지를 보장하지 않는다. 이 제한을 우회하기 위해 브라우저 보호를 완화하지 않는다.
- 복원된 동의도 exact origin, 현재 인증, 연결된 bridge, 새 ephemeral sync session/capability 조건을 모두 충족해야 전송에 사용된다. Dashboard가 닫혀 있는 동안 Extension이 서버 전송을 시작하는 것은 아니다.
- multiple-tab safety stop 또는 popup의 명시적 auto-sync OFF 뒤에는 저장된 동의만으로 자동 source transfer를 재개하지 않는다. conflict 해소 후 현재 계정에서 다시 명시적인 eligible ON이 필요하다.

이 결정은 Issue #104의 계정 구분 없는 boolean 저장과 이후의 매 화면 인증 확인 시 동의 초기화 구현을 대체한다. Extension/API wire contract 및 계정 정보의 Extension 전달 금지는 변경하지 않는다.

### 활성 상태

사용자가 자동 동기화를 활성화하고 authenticated Dashboard가 Extension과 연결되어 있으면:

1. Dashboard가 Port를 유지한다.
2. Extension에서 새 정답 capture가 IndexedDB에 commit된다.
3. Extension은 Port로 코드 없는 `CAPTURE_CHANGED` 이벤트만 보낸다.
4. Dashboard는 debounce 후 pending page를 pull한다.
5. Dashboard가 Main API에 저장한다.
6. 성공 또는 동일 사용자 중복으로 확정된 record만 ACK한다.

한 번에 여러 capture 이벤트가 와도 record별 push를 하지 않고 **pending drain**으로 합쳐 처리한다.

### Dashboard가 닫힌 경우

- Extension은 정상적으로 로컬 capture를 계속한다.
- 외부 네트워크 요청은 없다.
- 다음 Dashboard 접속 시 연결 직후 pending summary를 확인하고 자동 drain 한다.

Dashboard가 **background/hidden일 뿐 닫히지 않은 경우**는 위의 닫힘 상태와 다르다. 단일 eligible Port와 인증/동의가 유지되면 auto-sync는 계속 가능하며 GitHub auto-commit도 별도 target/consent/lease 조건을 만족하는 동안 계속 가능하다.

따라서 자동 동기화의 의미는 "Extension이 항상 서버에 push"가 아니라 **"eligible Dashboard가 있을 때 Dashboard가 자동으로 local pending을 drain"**하는 것이다.

### 로그아웃/계정 전환

- Dashboard logout 또는 authenticated account 변경 시 현재 Port/capability를 즉시 폐기한다.
- 새 계정 컨텍스트에서는 source transfer 전에 auto-sync가 다시 eligible 상태인지 Dashboard가 확인해야 한다.
- Extension은 GitHub user id, CodeArchive user id, email 등 계정 식별자를 저장하지 않는다.
- 이미 ACK된 기록은 새 계정에 자동 재전송하지 않는다.
- 과거 기록을 다른 계정으로 다시 가져오려면 Dashboard에서 명시적인 `all`/re-import 동작과 대상 계정 확인이 필요하다.

## Chrome 브라우저 브리지

MVP는 Chrome external messaging의 long-lived Port를 사용한다.

Dashboard 웹 페이지가 stable Extension ID를 대상으로 연결을 시작한다. Extension은 임의 웹 페이지를 찾아가 연결하지 않는다.

Extension manifest의 `externally_connectable.matches`는 승인된 Dashboard의 **정확한 HTTPS origin**만 허용한다. Background worker는 연결 시에도 `sender.origin`, `sender.url`, `sender.tab.id`를 다시 검사한다.

Bridge의 source-code 접근은 ephemeral capability로 제한한다. capability는 현재 external Port/tab/origin에 묶이고 background worker 메모리에만 존재한다.

폐기 조건:

- Port disconnect
- Dashboard logout/account context change
- tab navigation 또는 tab close
- exact origin 불일치
- multiple exact-origin Dashboard Port 감지에 따른 safety stop
- 마지막 정상 요청 후 2분 inactivity
- 생성 후 15분 absolute expiry
- terminal sync-session 종료
- Extension service worker restart

폐기 후 replay는 거부한다.

### 허용 메시지

기존 source/capability data plane은 그대로 유지한다.

```ts
type DashboardBridgeRequest =
  | { type: "CODEARCHIVE_PING"; protocolVersion: 1 }
  | { type: "CODEARCHIVE_CAPTURE_SUMMARY"; protocolVersion: 1 }
  | {
      type: "CODEARCHIVE_SYNC_SESSION_START";
      protocolVersion: 1;
      syncSessionId: string;
      authenticated: true;
      autoSyncConsent: true;
    }
  | {
      type: "CODEARCHIVE_SYNC_SESSION_END";
      protocolVersion: 1;
      syncSessionId: string;
    }
  | {
      type: "CODEARCHIVE_IMPORT_BEGIN";
      protocolVersion: 1;
      syncSessionId: string;
    }
  | {
      type: "CODEARCHIVE_CAPTURE_PAGE";
      protocolVersion: 1;
      capability: string;
      cursor?: string;
      limit: number;
      scope: "pending" | "all";
    }
  | {
      type: "CODEARCHIVE_CAPTURE_ACK";
      protocolVersion: 1;
      capability: string;
      importBatchId: string;
      clientRecordIds: string[];
    };

type ExtensionBridgeEvent =
  | {
      type: "CODEARCHIVE_CAPTURE_CHANGED";
      protocolVersion: 1;
      pendingCount: number;
      revision: number;
    };
```

Issue #159 automation control plane은 위 union에 섞지 않고 방향별 별도 shared union으로 유지한다.

```ts
type ExtensionToDashboardAutomationMessage =
  | { type: "CODEARCHIVE_AUTOMATION_STATE_REQUEST"; protocolVersion: 1 }
  | {
      type: "CODEARCHIVE_AUTOMATION_SET_REQUEST";
      protocolVersion: 1;
      automation: "AUTO_SYNC" | "GITHUB_AUTO_COMMIT";
      enabled: boolean;
    }
  | {
      type: "CODEARCHIVE_AUTOMATION_SAFETY_STOP";
      protocolVersion: 1;
      errorCode: "MULTIPLE_DASHBOARD_TABS";
    };

type DashboardToExtensionAutomationMessage = {
  type: "CODEARCHIVE_AUTOMATION_STATE_UPDATE";
  protocolVersion: 1;
  state: CodeArchiveAutomationState;
};
```

`CAPTURE_CHANGED`에는 source, title, problem URL, account data를 포함하지 않는다. Dashboard는 이 이벤트를 신호로만 사용하고 실제 record는 capability가 필요한 `CAPTURE_PAGE`로 pull한다.

Automation control/state에도 계정명/ID, repository/branch/folder 값, token/cookie/OAuth 값, source/code/title/problem URL을 포함하지 않는다. TypeScript exact-shape guard가 이 허용 필드 집합을 고정한다.

`CAPTURE_SUMMARY`는 코드·제목·URL 없이 pending/all count, revision, protocol version만 반환한다.

`IMPORT_BEGIN`은 다음 조건이 모두 만족될 때만 capability를 반환한다.

- sender exact origin 검증 성공
- Dashboard가 authenticated/auto-sync eligible handshake를 완료
- Port가 현재 tab과 연결되어 있음
- exact-origin Dashboard Port가 하나뿐임
- protocol version 지원

Dashboard는 자체 서버 세션에서 로그인과 명시적 자동 동기화 동의를 확인한 뒤에만
`SYNC_SESSION_START`를 보낸다. `syncSessionId`는 계정·사용자 ID·토큰이 아닌 예측 불가능한
auth-context별 nonce이며, 로그인/동의 상태 또는 계정이 바뀔 때 재사용하지 않는다.
로그아웃, 동의 철회, 계정 전환 또는 multiple-tab safety stop 전에 `SYNC_SESSION_END` 또는 동등한 Port teardown을 수행해야 하며 Extension은 해당 세션의 capability를 즉시 폐기한다. 새 session start 역시 이전 capability를 폐기한다.

Extension은 Dashboard 서버의 로그인 상태를 독립적으로 검증하거나 계정 정보를 보관하지
않는다. exact-origin Dashboard가 이 상태를 assertion하는 것이 신뢰 경계다. 따라서 동일
origin 내 script 실행 권한 탈취는 Dashboard의 CSP, dependency 통제, 세션 보안으로 방어한다.

MVP 제한:

- page `limit <= 25`
- response payload `<= 1 MiB`
- 한 sync capability의 page request `<= 100`
- ACK는 해당 capability/session에서 실제 제공한 `clientRecordId`의 부분집합만 허용
- response/error는 고정 envelope와 안전한 오류 코드만 사용
- automation control/state는 shared exact shape만 허용
- 내부 exception, OAuth 값, cookie, token, provider/API raw body는 반환하지 않음

## Main API 요청 매핑

Dashboard는 bridge의 중첩 `CaptureImportRecord`를 그대로 전송하지 않고 shared-types의
`toMainApiSolutionBulkUpsertRecord`를 사용해 Spring
`CaptureBulkUpsertRequest.CaptureItem`의 평면 wire shape로 변환한다.

| Bridge 값 | Main API 값 | 규칙 |
| --- | --- | --- |
| `clientRecordId` | `clientRecordId` | 변경 없이 보존 |
| `problem.platform` | `platform` | 변경 없이 보존 |
| `problem.problemNumber` | `problemNumber` | 없으면 필수 `problem.platformProblemId` 사용 |
| `problem.title` | `title` | 변경 없이 보존 |
| `language`, `code`, `result` | 같은 이름의 평면 필드 | 변경 없이 보존 |
| `submittedAt` | `solvedAt`, `observedAt` | ACCEPTED capture의 동일한 제출 관찰 시각으로 둘 다 설정 |
| 숫자 `executionTime`, `memoryUsage` | 문자열 필드 | 있으면 단위를 추정하지 않고 10진 문자열로 변환, 없으면 `null` |
| bridge에 없음 | `aiUsage` | 명시적으로 `"unknown"` 전송 |

API 요청에는 중첩 `problem` 객체와 `userId`/account ownership 필드를 넣지 않는다. 소유권은
인증된 Dashboard 세션에서 서버가 결정한다. 한 batch의 record 수는 1..25이며
`importBatchId`는 관찰/ACK receipt 상관관계용일 뿐 idempotency key가 아니다.

현재 bridge의 `submittedAt`은 SWEA ACCEPTED 결과를 감지한 event instant이므로 MVP의 두 API
timestamp를 결정하기에 충분하다. 별도의 사용자 수정 풀이 날짜나 독립 관찰 시각이 필요해지면
기존 필드 의미를 재해석하지 않고 bridge/API 계약을 별도 버전으로 확장한다.

## 기록 수명 주기

```text
captured_local
     │
     ├─ Dashboard 없음 ───────────────┐
     │                                │
     ▼                                │
pending_for_dashboard ◄──────────────┘
     │
     │ eligible Dashboard auto-drain
     ▼
offered_in_sync_session
     │
     ├─ API rejected/transient failure → pending 유지
     │
     ▼
imported_to_server
     │
     ▼
acknowledged_local_receipt
```

- `clientRecordId`는 Extension이 capture 시 생성한 불변 UUID다.
- API idempotency boundary는 `(userId, clientRecordId)`다.
- `importBatchId`는 관찰/추적용이며 idempotency key 자체가 아니다.
- ACK는 API가 성공 또는 **동일한 authenticated user에 이미 존재**한다고 확정한 ID에만 보낸다.
- ACK 실패는 서버 저장을 롤백하지 않는다. 다음 sync에서 API idempotency가 중복을 흡수한다.
- sync 완료 후에도 로컬 record는 기본 삭제하지 않는다.
- `pending`은 local ACK receipt가 없는 record만 제공한다.
- `all`은 명시적인 사용자 re-import 동작에만 사용한다.

## 동시성 및 재시도

Dashboard는 하나의 Extension connection에 대해 하나의 active drain만 실행한다. **2개 이상의 Dashboard Port가 연결되면 자동화 실행은 fail-closed하며 어느 Port도 임의 owner로 선택하지 않는다.**

- `CAPTURE_CHANGED`가 drain 중 도착하면 `revision`을 기억하고 현재 drain 완료 후 summary를 다시 조회한다.
- API transient failure는 Dashboard에서 bounded retry/backoff 한다.
- Extension은 API retry를 수행하지 않는다.
- partial API result에서는 성공/동일사용자중복 ID만 ACK한다.
- rejected record는 Dashboard에서 이유를 안전하게 표시하고 pending 상태를 유지하거나 사용자 조치 대상으로 둔다.
- 동일 record가 reconnect/race로 다시 전송되어도 API idempotency로 중복 row를 만들지 않는다.
- multiple-tab conflict 해소 후 자동 drain/GitHub auto-run은 자동 재개하지 않고 새 명시적 ON을 요구한다.
- GitHub write 결과가 UNKNOWN/불확실하면 자동 retry하지 않는다.

## 인증과 보안

- GitHub OAuth callback은 Web Dashboard/Main API 흐름에서만 사용한다.
- Extension에서 `identity` permission과 Main API `host_permissions`를 제거하는 것이 목표 상태다.
- Dashboard exact origin을 `externally_connectable`에 추가하는 manifest 변경은 브라우저 보안 경계 변경이므로 구현 직전 별도 owner approval gate를 거친다.
- Dashboard session만 Main API에 인증된다.
- Bridge record는 untrusted input으로 보고 shared schema와 Main API에서 다시 검증한다.
- 문제 원문, 플랫폼 cookie/login 정보, 브라우저 session, OAuth token은 bridge payload에 포함하지 않는다.
- Source code는 product 기능상 필요한 capture record에만 포함하고, Dashboard auto-sync 활성화 전에는 외부로 전송하지 않는다.
- popup automation control plane은 source-bearing capability와 분리되며 계정/target/source/token을 운반하지 않는다.
- exact-origin 허용만으로 계정 전환을 자동 승인한 것으로 보지 않는다. logout/account change는 기존 capability를 끝낸다.

배포 차단 보안 테스트:

- 비허용 origin connection 거부
- unsupported protocol 거부
- capability 없는 page/ack 거부
- 다른 tab/Port에서 capability replay 거부
- idle/absolute expiry 후 replay 거부
- 제공되지 않은 clientRecordId ACK 거부
- page/request count/payload limit 초과 거부
- logout/account-context change 후 기존 capability 사용 거부
- multiple Dashboard Port 감지 시 capability/automation fail-closed
- `CAPTURE_CHANGED`가 source/code/title/URL을 노출하지 않음
- automation control/state exact shape가 account/repository/token/source 필드를 허용하지 않음
- Extension에서 Main API/OAuth/token 경로가 cleanup 후 완전히 제거됨

## 실패 처리

| 상황 | 동작 |
| --- | --- |
| Extension 미설치/비활성 | Dashboard에서 설치 안내 및 JSON 수동 가져오기 제공 |
| Dashboard 닫힘 | Extension local capture 유지, 다음 연결에서 자동 catch-up |
| Dashboard background/hidden | 단일 eligible Port·인증·동의가 유지되면 auto-sync 지속; GitHub auto-commit은 target/consent/lease까지 유효한 동안 지속 |
| Dashboard 로그아웃 | Port/capability 종료, local capture 유지 |
| account 전환 | 이전 sync session 종료, 새 account에서 eligibility 재확인 |
| Dashboard 2개 이상 연결 | 모든 자동 실행 safety stop, capability 폐기, fixed `MULTIPLE_DASHBOARD_TABS`, conflict 해소 후 명시적 재활성화 |
| bridge version 불일치 | 업데이트 안내, 데이터 변경 없음 |
| API 일부 실패 | 성공/동일사용자중복 ID만 ACK, 실패 record pending 유지 |
| Dashboard tab 종료/navigation | capability 폐기, auto-run stop, local capture 유지 |
| offline/lease 실패 | 자동 실행 중단, 자동 재개/불확실 GitHub retry 금지 |
| 중복 가져오기 | `(userId, clientRecordId)` idempotent upsert |
| ACK 전 Port 종료 | 다음 연결에서 재전송 가능, API idempotency로 중복 흡수 |

## Dashboard 상태 모델

Dashboard는 최소한 다음 상태를 구분한다.

```text
extension_missing
extension_connected_sync_off
extension_connected_sync_ready
syncing
sync_idle
sync_degraded
signed_out
```

사용자에게는 technical bridge label 대신 다음처럼 설명한다.

- 자동 동기화 켜짐
- 로컬 기록 동기화 중
- 모두 동기화됨
- 로컬 기록 N개 대기 중
- 일부 기록 동기화 실패
- Extension 연결 필요
- 로그인 필요
- Dashboard 탭이 여러 개라 자동 실행 중단됨
- GitHub 대상/동의 확인 필요

Popup에는 위 상세 account/target 값을 보내지 않고 `CodeArchiveAutomationState`의 booleans와 고정 `errorCode`만 보낸다.

## 구현 순서

기존 capture-only 전환의 순서는 다음과 같다.

1. shared capture/import schema, `clientRecordId`, protocol version, bulk-upsert result contract를 동결한다.
2. Extension에 exact-origin Port bridge, capability, paginated pending read, ACK, metadata-only `CAPTURE_CHANGED`를 추가한다. 기존 OAuth/direct-sync 경로는 아직 제거하지 않는다.
3. Dashboard를 초기화하고 Web GitHub OAuth/session 및 Extension 연결 상태를 구현한다.
4. Dashboard auto-sync opt-in, connection lifecycle, pending catch-up/drain, API bulk upsert, partial ACK를 구현한다.
5. Main API에서 `(userId, clientRecordId)` idempotent bulk upsert와 per-record result를 검증/보강한다.
6. 개발/베타 환경에서 real Chrome E2E를 수행한다.
7. replacement E2E 통과 후 별도 cleanup PR에서 Extension OAuth, auth/session/sync UI/runtime, `identity`, Main API host permission, Extension 전용 API/CORS 사용처를 제거한다.
8. cleanup 후 다시 real Chrome regression을 수행한다.

Issue #159 popup automation control 후속은 반드시 shared contract를 먼저 고정한 뒤 Extension과 Dashboard 구현을 분리한다.

1. Integrator가 shared automation control types와 본 handoff/GitHub auto-commit 문서를 확정한다.
2. Client Builder가 `apps/extension/**`에서 popup/control routing과 multi-tab safety를 구현한다.
3. 별도 Client Builder chat/PR에서 `apps/web/**` authoritative control/background execution을 구현한다.
4. Quality Reviewer가 browser/source/security/GitHub duplicate-write 경계를 독립 검토한다.
5. Integrator가 exact PR heads와 검증을 종합하고 owner merge gate를 거친다.
6. 별도 beta deployment/package approval 뒤 exact `develop`으로 Real Chrome E2E를 수행한다.

## Real Chrome E2E 완료 조건

기존 capture-only 완료 조건:

- Dashboard/API가 없어도 SWEA 정답 코드가 IndexedDB에 저장된다.
- Dashboard login 후 auto-sync를 켜면 기존 pending 기록이 자동으로 서버에 저장된다.
- Dashboard가 열린 상태에서 새 SWEA PASS가 발생하면 별도 수동 import 버튼 없이 서버 기록으로 반영된다.
- Dashboard를 닫은 동안 capture한 기록이 다음 연결 시 자동 catch-up된다.
- partial failure에서 성공한 record만 ACK된다.
- reconnect/retry 후 duplicate server record가 생성되지 않는다.
- logout/account switch 후 이전 capability로 추가 source transfer가 되지 않는다.
- Extension은 CodeArchive/GitHub token을 저장하지 않는다.
- Extension은 Main API를 직접 호출하지 않는다.
- Extension local record는 sync 성공 후에도 유지된다.

Issue #159 control-plane acceptance에는 추가로 다음을 포함한다.

- popup에서 auto-sync ON/OFF 상태를 Dashboard authoritative 결과로 확인한다.
- popup에서 GitHub auto-commit ON/OFF를 요청하되 target/consent 값은 Extension에 전달되지 않는다.
- Dashboard를 background tab으로 둔 상태에서 새 ACCEPTED capture가 Main API와 GitHub에 각각 한 번만 반영된다.
- GitHub auto-commit OFF 뒤 새 capture는 서버에는 sync되지만 GitHub에는 commit되지 않는다.
- auto-sync OFF 뒤 새 capture는 서버/GitHub 전송 없이 IndexedDB에만 남는다.
- logout/account switch/tab close/navigation/offline에서 자동 실행이 중단된다.
- background 상태에서 최소 한 번의 GitHub auto-commit lease renewal/tick을 통과하며, timer throttling으로 lease가 실패하면 안전 OFF한다.
- Dashboard 탭 2개 연결 시 두 자동화가 fail-closed OFF되고 source/GitHub auto write가 없으며, 한 탭을 닫아도 자동 재개하지 않는다.
- control/state payload에 account name/id, repository/branch/folder, token/cookie/OAuth, source/code/title/problem URL이 없다.

## 개발/베타와 Production 환경

브랜치와 배포 환경은 분리한다.

```text
feature/fix branch
  → PR
  → develop
  → development/beta deployment + real-browser acceptance
  → develop → master release PR
  → master
  → Production deployment
```

- `develop`은 통합 개발 브랜치이며 development/beta runtime의 배포 소스다.
- development/beta 배포는 정확한 reviewed `develop` commit을 사용한다.
- `master`는 Production 배포 소스다.
- Production을 `develop`에서 배포하지 않는다.
- routine development를 `master`에서 하지 않는다.
- development/beta 배포 승인과 Production 배포 승인은 서로 다른 gate다.
- `develop → master` merge 승인도 Production 배포 승인을 대신하지 않는다.
- provider auto-deploy는 별도 owner 결정이 있기 전까지 비활성 상태를 유지한다.
- 현재 provider 자원이 beta 용도라면 beta 자원으로 유지한다. 별도 Production 자원 생성/전환은 이후 비용·운영 설계 및 승인 대상이다.

## 기존 OAuth/direct-sync 경로 전환

- 새 bridge/auto-sync 경로가 real Chrome에서 검증되기 전에는 기존 Extension OAuth/direct-sync 코드를 한 PR에서 즉시 삭제하지 않는다.
- 새 경로가 검증된 뒤 별도 cleanup PR로 legacy client code와 권한을 제거한다.
- 기존 Main API user/session/solution 기반은 Dashboard가 재사용한다.
- Extension 전용 login/exchange endpoint와 exact Extension CORS allowlist는 사용처 제거가 확인된 뒤 service cleanup 대상으로 분리한다.
- 기존 Extension OAuth 문제를 추적하던 issue는 새 설계 merge 시 자동으로 계속 수행하지 않는다. Integrator가 각각 `superseded`, `re-scope`, 또는 Dashboard/API에 여전히 필요한 운영 문제인지 분류한다.
