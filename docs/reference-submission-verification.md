# 기존 CodeArchive 제출 검증 참고

사용자 요청에 따라 기존 공개 저장소를 참고했다. 기존 저장소의 개발 워크플로 지시문은 현재 프로젝트의 실행 지시로 사용하지 않는다.

- 저장소: https://github.com/devkimhongjin/codeArchive
- 참고 브랜치: `develop`
- 확인한 커밋: `1fb16686bf48b6c2495bf04610f59c4ab1a78480`
- 참고 사본은 현재 프로젝트 외부의 작업 폴더에 있으며, 원격 저장소를 수정하지 않는다.

## SWEA

기존 구현은 `div.popup_layer.show > div > p.txt`의 결과 문구를 관찰하고, `PASS입니다`를 Accepted로 분류한다. 이번 프로젝트에서는 성공 문구를 엄격히 확인하고 제출 당시 코드·문제 스냅샷과 결합한다. 일반적인 결과 class 검색으로 페이지의 다른 PASS 문구를 수집하지 않는다.

문제 번호와 제목은 `div.problem_box > h3`의 `1234. 문제 제목` 형식에서 읽고, `contestProbId`는 별개의 문자열 식별자로 취급한다. URL과 입력 필드의 식별자가 충돌하면 수집하지 않는다.

문제 원문 링크는 일반 문제의 `/main/code/problem/problemDetail.do`와 사용자 문제의 `/main/code/userProblem/userProblemDetail.do`에서 URL query와 단일 hidden `contestProbId`가 일치할 때만 로컬 컨텍스트로 보존한다. Query가 없는 풀이 페이지에서는 현재 hidden ID와 정확한 `document.referrer`가 보존한 컨텍스트에 모두 일치해야 원문 링크로 사용한다. 컨텍스트는 새 창과 장시간 대기를 위해 유지하지만, 다른 문제 ID·중복 ID·빈 ID·오래된 referrer가 관찰되면 임의로 URL을 만들지 않고 수집하지 않는다.

편집기는 `cEditor.save()`로 원본 저장 필드를 갱신한 뒤 `#textSource`를 읽는 기존 방식을 참고한다. 기존 코드의 인라인 onclick 브리지 대신 패키지에 포함된 MAIN world 스크립트를 사용해 페이지 CSP에 의존하는 인라인 실행을 피한다.

## Programmers

최종 제출 버튼은 `#submit-code`다. 실행·테스트 버튼은 제출 시도로 취급하지 않는다. 제출 후 새로 표시된 `#modal-dialog.modal.show[role='dialog'][aria-modal='true']`의 `h4.modal-title`이 정확히 `정답입니다!`일 때만 Accepted로 판단한다.

이미 열린 성공창, 이전 제출의 테스트 결과, 만료된 제출 시도는 현재 제출 결과로 사용하지 않는다. 코드는 제출 시점에 확보하며 결과가 나타난 뒤 수정된 편집기 텍스트로 대체하지 않는다.

## 검증 의미

현재 제출 시도는 60초와 페이지 URL에 묶이며, 로컬 저장 완료 시 해당 시도를 소비한다. 저장 중 다음 제출이 시작되어도 이전 저장 응답이 새 시도를 제거하지 않는다. SWEA 실행 시간·메모리는 아직 수집하지 않으며, Programmers는 제출 이후 변경된 결과 그룹에서만 선택적으로 읽는다.

기존 저장소의 selector와 fixture는 구현 근거이며, 현재 운영 사이트에서 실제 제출을 수행했다는 증거는 아니다. 실제 계정으로 SWEA PASS와 Programmers Accepted를 얻는 브라우저 E2E는 별도 검증이 필요하다.

## 원본 코드

- [SWEA 제출 관찰](https://github.com/devkimhongjin/codeArchive/blob/1fb16686bf48b6c2495bf04610f59c4ab1a78480/apps/extension/src/adapters/swea/sweaSubmissionResult.ts)
- [SWEA 편집기 동기화](https://github.com/devkimhongjin/codeArchive/blob/1fb16686bf48b6c2495bf04610f59c4ab1a78480/apps/extension/src/adapters/swea/sweaEditorSync.ts)
- [SWEA 문제 식별](https://github.com/devkimhongjin/codeArchive/blob/1fb16686bf48b6c2495bf04610f59c4ab1a78480/apps/extension/src/adapters/swea/sweaSolvingProblemMeta.ts)
- [Programmers 제출 관찰](https://github.com/devkimhongjin/codeArchive/blob/1fb16686bf48b6c2495bf04610f59c4ab1a78480/apps/extension/src/adapters/programmers/programmersSubmissionResult.ts)
