# 다음 작업과 확장 우선순위

2026-08-31 결정. 기준: `develop@8969013a953e6e11a0eaf32c77e6cbf9fe160c24`.
GitHub 이슈가 세부 범위와 인수 상태의 원본이며 이 문서는 작업 순서를 연결한다.
장기 개발 명세의 Phase 번호를 현재 베타 실행 순서로 해석하지 않는다.

## 현재 베타

- [#37](https://github.com/devkimhongjin/codeArchive/issues/37) / [#84](https://github.com/devkimhongjin/codeArchive/issues/84): 실제 Chrome 대체 동기화 검증을 마무리한다.
- **사용자 확인(2026-08-31): 두 계정에서 동기화한 대로 표시되며 동기화 후 로컬 기록이 그대로 유지된다.** 이는 사용자 보고이며 이 작업에서 직접 재현한 E2E 결과는 아니다.
- 아직 이 보고만으로 확정하지 않는 항목: 오프라인 수집, 재연결 pending drain, 연결 중 신규 수집, 부분 실패 시 성공분만 ACK, 반복 전송 중복 방지, 로그아웃/계정 전환 후 이전 capability 폐기, 배포 commit에 연결된 증거.
- [#86](https://github.com/devkimhongjin/codeArchive/issues/86): 위 entry criteria를 모두 확인한 뒤 레거시 OAuth/direct-sync 제거를 별도 범위로 진행한다. 기존 로컬 archive fallback은 보존한다.
- 바로 구현할 기능은 [#143](https://github.com/devkimhongjin/codeArchive/issues/143): [#96](https://github.com/devkimhongjin/codeArchive/issues/96)의 검색·필터·정렬 부분이다. 외부 실행 gate를 기다리는 동안 인증/동기화 경계 변경 없이 진행할 수 있다.

## 신규 기능 순서

이 표의 P1/P2/P3는 **신규 기능 간 순서**이며 장애 심각도나 베타 검증보다 높은 우선순위를 뜻하지 않는다.

| 순서 | 작업 | 선행 조건 / 이유 |
| --- | --- | --- |
| P1 | [#45 커뮤니티·CRUD](https://github.com/devkimhongjin/codeArchive/issues/45) | 사용자의 추가 결정: 저장한 코드를 다른 사람이 볼 수 있는 가치를 먼저 제공한다. 공개/비공개 전환·조회·수정·삭제와 공유 링크 → 공개 풀이 탐색 → 댓글 CRUD → 좋아요/취소. 사용자 격리와 공개 철회를 먼저 보장한다. |
| P2 | [#141 프로그래머스 → 정올](https://github.com/devkimhongjin/codeArchive/issues/141) | 커뮤니티 이후 수집 데이터를 확장한다. 개발 명세 2.2 순서를 따르며 플랫폼별 실제 DOM fixture와 최종 ACCEPTED 판정, 언어/문제 ID 계약을 먼저 확보한다. |
| P3 | [#142 분석·리더보드](https://github.com/devkimhongjin/codeArchive/issues/142) | 개인 분석부터 시작한다. 공개 리더보드는 커뮤니티의 공개/참여 동의와 집계 정의가 필요하다. |

플랫폼 확장은 베타 완료 이후다. 두 플랫폼의 capture는 API/Dashboard가 없어도 저장되어야 하고, 기존 Dashboard 동의 기반 전송 계약을 재사용한다. 새 origin/manifest 권한은 실제 주소를 확인하고 실행 직전 승인한다.

공개 풀이와 새 풀이 모두 PRIVATE가 기본값이다. 공개 코드와 AI artifact는 별도 동의이며 자동 동기화 동의는 공개 동의가 아니다. 댓글은 본인만 수정/삭제하고, 좋아요는 사용자/풀이 유일성으로 중복 증가를 막는다. 비공개 전환·삭제 시 public detail/list/comment/like/count 경로도 즉시 차단한다.

개인 분석은 사용자 전체 데이터에서 계산한다. 공개 solved count는 동일 플랫폼/문제를 한 번만 집계하고, 공개 참여를 철회하면 즉시 제외한다. 기간·timezone·동률 규칙을 먼저 확정한다. 수동 실행시간/메모리는 검증된 순위에 포함하지 않는다. 클라이언트 ACCEPTED 캡처를 외부 검증된 실적으로 오인시키지 않는다.

## #143 구현 경계

- 현재 조회한 서버 기록에만 검색 + 플랫폼 + 언어 AND 필터를 적용한다. 선택지는 실제 조회 데이터에서 생성하므로 플랫폼 지원을 새로 활성화하지 않는다.
- 최근 수정순, 오래된 수정순, 플랫폼·문제 번호순(자연 정렬)을 지원한다. 날짜 정렬은 그룹의 첫 제출 기준이고 동일 그룹의 제출에도 같은 방향을 적용한다. 문제 번호순의 제출은 최근 수정순이다. 동률은 고정된 식별자로 결정한다.
- 검색어는 문제 번호/제목/플랫폼/언어만 비교하고 소스 본문을 검색하지 않는다. 조건은 UI 메모리에만 두고 계정이 바뀌면 초기화한다.
- 기존 API 요청은 `limit=50`이다. 전체 서버 검색·전체 통계·서버 pagination을 구현한 것으로 표시하지 않는다. 전체 데이터 탐색은 별도 API 계약 작업이다.
- 현재 서버는 source provenance/개별 sync 상태를 충분히 제공하지 않는다. source/sync 필터는 추정값으로 만들지 않으며 후속 계약 전까지 보류한다.
- 수정 경로: `apps/web/src`의 목록 UI/필터/그룹 정렬/테스트/CSS, 이 문서와 `dashboard-beta-scope.md`. 서버·Extension·공유 wire type·의존성·배포 설정 변경 없음.
- 검증: 필터 조합, 빈 결과/초기화, 자연 정렬/동률/시간대, 상세 선택, 새로고침/계정 변경 회귀, Web typecheck/test/build. 실제 Chrome 두 계정 E2E 및 완전한 #96 UI/접근성 검토를 대신하지 않는다.

## 환경과 다음 인계

모든 구현은 `develop`에서 분기하고 `develop` PR로 전달한다. 병합·베타 배포·브라우저 권한 확대·Production 승격은 서로 별도의 실행 직전 승인 단계다. 유료 리소스, live AI, 외부 코드 업로드는 추가하지 않는다.

다음 역할: `@codearchive-integrator` (Strategic / Sol).
인계 요청: “#143 PR의 exact head, CI 및 자체검토 결과를 확인하고 #37/#84의 사용자 확인과 남은 E2E 증거를 구분하세요. 완료 조건이 충족되면 #86 정리를 분리하고, 신규 기능은 사용자 결정에 따라 #45 → #141 → #142 순서로 진행하세요. 다음 기능 설계는 공개/비공개 전환·공유 링크·공개 풀이 탐색부터 시작하세요. 병합과 배포는 별도 승인입니다.”
