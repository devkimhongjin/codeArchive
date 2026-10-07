# CodeArchive 구조

## 구현 방향

사용자 요청은 CodeArchive 개발 진행과 Figma UI 참고다. 첨부된 신규 구축 문서는 제품 요구사항으로 검토했으며, 외부 서비스 게시·계정 권한 변경·기존 파일 삭제에 대한 실행 권한으로 취급하지 않는다.

애플리케이션 코드가 없는 초기 폴더에서 React/TypeScript 대시보드, Manifest V3 확장 프로그램, Java/Spring Boot API를 구성한다. 기존 README의 Vue 계획 대신 신규 구축 문서의 React 구성을 채택한다.

```text
SWEA / Programmers
  → 제출 시도와 코드 스냅샷
  → 새 Accepted 결과 확인
  → 확장 프로그램 IndexedDB
  → 허용된 Dashboard의 Pending 요청
  → 인증된 API Bulk 저장
  → 저장이 확인된 captureId만 ACK
```

## 책임

- `apps/extension`: 플랫폼 Adapter, 로컬 영속 저장, 제한된 외부 메시지 인터페이스. 서버 인증정보를 보관하거나 GitHub를 호출하지 않는다.
- `apps/dashboard`: 로그인, 풀이 탐색, 확장 프로그램 연결과 명시적 동기화. 데모 데이터는 실제 계정 데이터와 분리한다.
- `apps/api`: GitHub OAuth 로그인, 사용자별 풀이 저장, captureId 중복 방지. 향후 GitHub App 저장소 권한 검증과 자동화 실행을 담당한다.

## 보안 경계

- Capture는 명확한 성공 결과와 유효한 메타데이터·코드가 함께 있을 때만 생성한다.
- 로컬 저장 완료 후 외부 동기화가 가능하다. 서버 실패는 원본 Capture를 삭제하지 않는다.
- 확장 프로그램 연결은 정확한 `http://localhost:5173` origin으로 제한한다. 운영 배포 시 manifest와 런타임 origin 검사를 함께 변경해야 한다.
- Capability는 짧은 수명과 발급받은 브라우저 문맥에 묶인다. ACK는 그 연결에서 전달한 Capture에 한정한다.
- 서버가 GitHub에서 받은 고유 ID로 로그인한 사용자를 결정한다. 클라이언트가 보낸 예상 계정은 불일치를 거부하는 조건일 뿐 권한 근거가 아니다. 이메일이나 GitHub 사용자명이 바뀌어도 고유 ID가 같으면 동일한 계정이다.
- 자동 동기화와 GitHub 자동 커밋은 초기 상태에서 켜지지 않는다.

## Dashboard가 닫힌 경우

현재 경로에서는 로컬 수집과 보관이 계속 가능하지만 서버 동기화는 Dashboard 재연결 후 수행한다. 문서의 향후 Secure Capture Relay는 별도 설계 대상이다. 'Extension은 Main API를 직접 호출하지 않는다'는 제약을 유지하려면 Dashboard 수명과 독립적인 인증·동의·계정 바인딩을 가진 Relay가 필요하다. 이를 구현하지 않은 상태에서 닫힌 Dashboard의 서버 자동 동기화나 GitHub 자동 커밋을 지원한다고 표시하지 않는다.

## DB 스키마 관리

PostgreSQL은 Flyway 마이그레이션을 적용한 뒤 Hibernate `validate`로 엔티티 매핑을 확인한다. 비어 있지 않은 미등록 스키마를 자동 채택하지 않으며, 기존 DB의 도입은 백업·스키마 확인·명시적 baseline 절차로 분리한다. 개발용 H2의 `local`/`test` 프로필에서는 Flyway를 비활성화해 기존 파일 DB와 메모리 테스트를 보존한다.

## GitHub 후속 단계

GitHub App 설치 소유권을 immutable account ID로 확인하고 저장소·브랜치 선택, 코드·경로·공개 범위 미리보기를 구현한다. 자동 커밋은 별도 동의 이후의 신규 Capture에만 적용한다. 파일 생성 전용 정책과 HEAD/권한/visibility 변경 검증이 필요하다. Mutation 전송 후 결과가 불명확하면 `UNKNOWN`으로 남기고 자동 재시도하지 않는다. 실제 App 자격증명과 설치가 준비되기 전에는 쓰기 기능을 활성화하지 않는다.

## 디자인 출처

[CodeArchive Figma – 전체 풀이](https://www.figma.com/design/MjmogsVNXfKIxuGbJ8btWh/CodeArchive-Dashboard-Archive-UI?node-id=5-2)

Figma MCP는 Starter 호출 한도 때문에 디자인 코드와 자산을 반환하지 못했다. 사용자가 지정한 브라우저 탭의 실제 프레임을 읽어 연보라 배경, 상단 메뉴, 풀이 목록/상세 분할, 어두운 코드 영역을 참고했다. 원본 자산 및 전체 디자인 토큰을 추출한 픽셀 단위 복제는 아니다.

## 기술 참고

- [Spring Boot 3.5 실행 요구사항](https://docs.spring.io/spring-boot/3.5/system-requirements.html)
- [Spring Boot 3.5 데이터베이스 초기화와 Flyway](https://docs.spring.io/spring-boot/3.5/how-to/data-initialization.html)
- [Flyway의 명시적 baseline 동작](https://documentation.red-gate.com/flyway/reference/commands/baseline)
- [Chrome 메시지 통신](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome externally_connectable](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable)
