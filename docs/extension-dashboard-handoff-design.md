# Extension → Dashboard 수집 인계 설계

## 결정

CodeArchive의 브라우저 확장은 코딩 플랫폼의 풀이를 감지하고 로컬 IndexedDB에 보존하는 수집기다. 사용자 인증, Main API 통신, 서버 동기화, 기록 관리, AI 및 외부 연동은 Web Dashboard가 전담한다.

확장은 GitHub OAuth를 시작하지 않고 CodeArchive access/refresh token을 저장하지 않으며 Main API를 직접 호출하지 않는다. 서버 또는 대시보드 장애가 수집을 막아서는 안 된다.

## 책임 경계

| 구성 요소 | 책임 | 금지 사항 |
| --- | --- | --- |
| Extension | 플랫폼 감지, 코드·결과 수집, 로컬 CRUD·내보내기, 대시보드 요청에 대한 로컬 기록 제공 | OAuth, 백엔드 토큰 저장, Main API 호출, AI·GitHub·Notion 호출 |
| Web Dashboard | GitHub 로그인, 확장 설치 감지, 로컬 기록 가져오기, 검토·중복 해결, API 저장, 전체 관리 | 플랫폼 DOM 직접 수집, 확장 저장소에 대한 무단 삭제 |
| Main API | 웹 세션, 사용자별 풀이 upsert, 중복 방지, 관리·연동 API | 확장을 신뢰된 사용자 세션으로 간주 |

## 데이터 흐름

```text
SWEA page
  → Extension content script
  → Extension background validation
  → Extension IndexedDB (authoritative local capture)

Signed-in Dashboard
  → installed Extension에 import page 요청
  ← capture records + cursor
  → 사용자 검토/선택
  → Main API bulk upsert (Dashboard session)
  ← per-record imported/duplicate/rejected result
  → Extension에 성공한 clientRecordId만 acknowledge
  → Extension은 importedAt/importBatchId 메타데이터만 기록
```

대시보드가 열려 있지 않으면 서버 전송은 일어나지 않는다. 수집은 계속되며 다음 대시보드 방문 때 가져온다.

## 브라우저 브리지

MVP는 Chrome의 외부 메시지 채널을 사용한다. Extension manifest의 `externally_connectable.matches`는 배포된 대시보드의 정확한 HTTPS origin만 허용한다. 대시보드는 안정화된 Extension ID로 메시지를 보내고, background worker는 `sender.origin`, `sender.url`, `sender.tab.id`를 다시 검사한다.

`PING`과 코드가 없는 요약 외에는 Extension 팝업에서 사용자가 **현재 CodeArchive Dashboard 탭으로 가져오기 허용**을 누른 뒤에만 사용할 수 있다. background worker는 현재 활성 탭과 exact origin에 묶인 암호학적 난수 import-session capability를 메모리에 생성한다. 세션은 마지막 정상 요청 후 2분 동안 활동이 없거나 생성 후 15분이 지나거나, 탭 이동·종료 또는 terminal acknowledge가 완료되면 폐기한다. 정상 pagination과 최종 acknowledge까지는 같은 세션을 반복 사용하지만, 폐기 후 replay는 거부한다. service worker가 재시작되면 다시 승인을 받아야 한다.

브리지는 로그인 정보나 서버 토큰을 전달하지 않는다. 허용 메시지는 다음 다섯 가지로 제한한다.

```ts
type DashboardBridgeRequest =
  | { type: "CODEARCHIVE_PING"; protocolVersion: 1 }
  | { type: "CODEARCHIVE_CAPTURE_SUMMARY"; protocolVersion: 1 }
  | { type: "CODEARCHIVE_IMPORT_BEGIN"; protocolVersion: 1 }
  | { type: "CODEARCHIVE_CAPTURE_PAGE"; protocolVersion: 1; capability: string; cursor?: string; limit: number; scope: "pending" | "all" }
  | { type: "CODEARCHIVE_CAPTURE_ACK"; protocolVersion: 1; capability: string; importBatchId: string; clientRecordIds: string[] };
```

`CAPTURE_SUMMARY`는 코드·제목·URL 없이 pending/all 개수와 protocol version만 반환한다. `IMPORT_BEGIN`은 활성 사용자 승인 grant가 있을 때만 capability를 반환한다. `limit`은 최대 25개, 응답 payload는 최대 1 MiB, 한 import session의 page 요청은 최대 100회로 강제한다. background worker는 세션에서 실제 제공한 `clientRecordId` 집합을 추적하고, ACK 목록을 그 부분집합으로 제한한다. 응답은 고정된 envelope와 오류 코드만 사용하고 내부 예외, OAuth 값, 쿠키 또는 토큰을 포함하지 않는다. 대용량 기록은 cursor 기반 페이지로 나누며, capability가 없거나 만료·폐기 후 replay·다른 탭에서 제출된 요청은 코드 접근 전에 거부한다.

## 기록 수명 주기

```text
captured_local → offered_to_dashboard → imported_to_server
       │                    │
       └──── export ────────┘
```

- `clientRecordId`는 확장에서 생성한 불변 UUID이며 API idempotency key로 사용한다.
- API는 `(userId, clientRecordId)`를 고유하게 처리한다.
- acknowledge는 API가 성공 또는 동일 사용자 중복으로 확정한 ID에만 보낸다. 이 receipt는 사용자 소유권이 아니라 “어느 계정엔가 한 번 전달 확인됨”을 뜻한다.
- acknowledge 실패는 서버 저장을 롤백하지 않는다. 다음 가져오기에서 API idempotency로 중복을 흡수한다.
- 가져오기 완료 후에도 로컬 기록은 기본적으로 삭제하지 않는다. 삭제는 별도 사용자 동작이다.
- 기본 `pending` 범위는 전달 확인 receipt가 없는 기록만 제공한다. `all` 범위는 이미 전달된 기록도 포함하며 Dashboard에서 사용자가 **전체 로컬 기록 다시 가져오기**를 명시적으로 선택한 경우에만 요청한다.
- 다른 대시보드 계정으로 가져올 때는 사용자에게 대상 계정을 명확히 표시한다. 이미 전달된 기록은 자동으로 다시 제공하지 않으며, 사용자가 `all` 범위와 대상 계정을 확인해야 한다. 확장은 계정 식별자나 소유권을 저장하지 않는다.

## 인증과 보안

- GitHub OAuth callback은 Web Dashboard/Main API 흐름에서만 사용한다.
- 확장에서 `identity` permission과 Main API `host_permissions`를 제거하는 것이 목표 상태다.
- Dashboard origin을 `externally_connectable`에 추가하는 manifest 변경은 브라우저 보안 경계 변경이므로 구현·배포 전에 승인을 받는다.
- 대시보드 세션만 Main API에 인증된다. 브리지에서 받은 데이터는 신뢰하지 않고 shared schema와 API에서 다시 검증한다.
- 문제 원문, 플랫폼 쿠키·로그인 정보, 브라우저 세션, OAuth token은 브리지 payload에 포함하지 않는다.
- 외부 메시지 요청 횟수, page limit, payload 크기에 상한을 둔다.
- 승인되지 않은 page/ack 요청, capability의 다른 탭 사용, idle/absolute 만료, terminal ACK 후 replay, 제공되지 않은 ID의 ACK, limit/payload 초과를 거부하는 보안 테스트를 배포 차단 조건으로 둔다.

## 실패 처리

| 상황 | 동작 |
| --- | --- |
| 확장 미설치/비활성 | 대시보드에서 설치 안내 및 JSON 가져오기 제공 |
| 대시보드 로그아웃 | 로컬 수집 유지, 서버 가져오기 비활성 |
| 브리지 버전 불일치 | 업데이트 안내, 데이터 변경 없음 |
| API 일부 실패 | 성공 ID만 acknowledge, 실패 항목은 재시도 가능 |
| 대시보드 탭 종료 | 로컬 기록 유지, 다음 방문에 재개 |
| 중복 가져오기 | `(userId, clientRecordId)` idempotent upsert |

## 구현 순서와 완료 조건

1. 공유 capture/import schema와 protocol version을 정의한다.
2. 기존 OAuth/direct-sync 경로를 유지한 채 Extension에 사용자 승인 capability와 외부 read/ack 브리지를 추가한다.
3. Dashboard를 초기화하고 웹 GitHub OAuth 및 확장 연결 상태를 구현한다.
4. Dashboard import preview, 선택, API bulk upsert, 성공 acknowledge를 구현한다.
5. 실제 Chrome에서 offline capture → dashboard login → 사용자 승인 → import → 재가져오기 중복 없음까지 검증한다.
6. E2E 통과 후 별도 cleanup PR에서 Extension OAuth·API sync UI/runtime/권한을 제거한다.

MVP 완료 조건:

- 로그인·API 장애 중에도 SWEA 정답 코드가 로컬에 저장된다.
- 로그인된 대시보드가 확장 기록을 페이지 단위로 가져와 사용자별 서버 기록으로 표시한다.
- 확장에는 OAuth UI, CodeArchive 토큰, Main API 직접 요청이 없다.
- 부분 실패와 반복 가져오기로 데이터가 손실되거나 중복 생성되지 않는다.
- 사용자 승인 capability 없이 외부 페이지가 로컬 코드 page를 읽거나 acknowledge할 수 없다.
- 계정 전환 시 acknowledged 기록은 자동 재전송되지 않고 명시적 `all` 범위 확인을 거친다.

## 전환 계획

- 기존 Extension OAuth와 direct sync 코드는 새 브리지 인수 테스트가 통과할 때까지 한 PR에서 즉시 삭제하지 않는다.
- 먼저 새 경로를 구현하고 검증한 뒤, 별도 cleanup PR에서 `identity`, Main API host permission, auth/session/sync UI와 런타임을 제거한다.
- 기존 서버 인증·solution API는 대시보드가 재사용한다. Extension 전용 login/exchange endpoint와 exact extension CORS allowlist는 사용처 제거 후 별도 cleanup 대상으로 남긴다.
