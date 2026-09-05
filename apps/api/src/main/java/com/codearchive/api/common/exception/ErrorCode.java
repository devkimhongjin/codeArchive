package com.codearchive.api.common.exception;

import org.springframework.http.HttpStatus;

public enum ErrorCode {

    BETA_ACCESS_REQUIRED(
            HttpStatus.FORBIDDEN,
            "초대 비밀번호 확인이 필요합니다."
    ),

    BETA_ACCESS_UNAVAILABLE(
            HttpStatus.SERVICE_UNAVAILABLE,
            "베타 입장이 준비되지 않았습니다. 운영자에게 문의해 주세요."
    ),

    AUTH_REQUIRED(
            HttpStatus.UNAUTHORIZED,
            "인증이 필요합니다."
    ),

    AUTH_FLOW_INVALID(
            HttpStatus.BAD_REQUEST,
            "인증 흐름이 올바르지 않거나 만료되었습니다."
    ),

    AUTH_EXCHANGE_INVALID(
            HttpStatus.UNAUTHORIZED,
            "인증 교환 코드가 올바르지 않거나 만료되었습니다."
    ),

    AUTH_PROVIDER_UNAVAILABLE(
            HttpStatus.SERVICE_UNAVAILABLE,
            "GitHub 인증을 사용할 수 없습니다."
    ),

    ACCESS_DENIED(
            HttpStatus.FORBIDDEN,
            "접근 권한이 없습니다."
    ),

    GITHUB_PREVIEW_NOT_ELIGIBLE(
            HttpStatus.FORBIDDEN,
            "자동 수집된 정답 풀이만 업로드 미리보기를 만들 수 있습니다."
    ),

    GITHUB_UPLOAD_TARGET_CHANGED(HttpStatus.CONFLICT, "저장소 상태가 변경되었거나 업로드할 수 없습니다. 다시 미리보기를 확인해 주세요."),
    GITHUB_AUTO_STOPPED(HttpStatus.CONFLICT, "자동 커밋이 꺼졌거나 실행 시간이 만료되었습니다. 새로 동의해 주세요."),
    GITHUB_AUTO_ACTIVE(HttpStatus.CONFLICT, "다른 화면에서 자동 커밋을 실행 중입니다. 먼저 꺼 주세요."),
    GITHUB_UPLOAD_INTENT_NOT_FOUND(HttpStatus.NOT_FOUND, "현재 로그인에서 확인할 수 있는 업로드 요청이 없습니다."),
    GITHUB_UPLOAD_INTENT_EXPIRED(HttpStatus.CONFLICT, "업로드 확인 시간이 만료되었습니다. 다시 미리보기를 확인해 주세요."),
    GITHUB_UPLOAD_CONSENT_REQUIRED(HttpStatus.BAD_REQUEST, "전송할 내용과 외부 공개 위험을 확인해 주세요."),
    GITHUB_UPLOAD_ALREADY_ATTEMPTED(HttpStatus.CONFLICT, "이미 실행된 대상입니다. 기존 요청의 결과를 확인해 주세요."),
    GITHUB_UPLOAD_OUTCOME_UNKNOWN(HttpStatus.CONFLICT, "업로드 결과를 확정할 수 없습니다. 자동 재전송하지 말고 저장소를 확인해 주세요."),

    RELAY_GRANT_INVALID(HttpStatus.UNAUTHORIZED, "수집 relay 인증이 올바르지 않습니다."),
    RELAY_GRANT_REVOKED(HttpStatus.FORBIDDEN, "수집 relay 권한이 철회되었거나 세대가 만료되었습니다."),
    AUTOMATION_GENERATION_STALE(HttpStatus.CONFLICT, "자동화 상태가 변경되었습니다. 최신 상태로 다시 확인해 주세요."),
    AUTOMATION_OWNERSHIP_CONFLICT(HttpStatus.CONFLICT, "다른 자동화 실행 주체가 활성 상태입니다."),
    AUTOMATION_NOT_ELIGIBLE(HttpStatus.CONFLICT, "현재 자동화 조건에서 실행할 수 없습니다."),
    AUTOMATION_INVOCATION_INVALID(HttpStatus.UNAUTHORIZED, "자동화 실행 인증이 올바르지 않습니다."),
    AUTOMATION_INVOCATION_REQUEST_INVALID(HttpStatus.BAD_REQUEST, "자동화 실행 요청이 올바르지 않습니다."),
    AUTOMATION_INVOCATION_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "자동화 실행을 사용할 수 없습니다."),

    GITHUB_PREVIEW_SOURCE_CHANGED(
            HttpStatus.CONFLICT,
            "풀이가 변경되었습니다. 최신 풀이로 미리보기를 다시 요청해 주세요."
    ),

    GITHUB_REFERENCE_CHANGED(
            HttpStatus.CONFLICT,
            "브랜치가 변경되었습니다. 브랜치를 다시 선택해 주세요."
    ),

    GITHUB_REPOSITORY_STATE_UNAVAILABLE(
            HttpStatus.CONFLICT,
            "저장소가 비어 있거나 현재 상태에서 탐색할 수 없습니다."
    ),

    GITHUB_DIRECTORY_LIMIT_EXCEEDED(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "폴더 목록이 너무 크거나 불완전하여 안전하게 탐색할 수 없습니다."
    ),

    GITHUB_PATH_NOT_FOUND(
            HttpStatus.NOT_FOUND,
            "탐색할 수 있는 폴더를 찾을 수 없습니다."
    ),

    GITHUB_INTEGRATION_UNAVAILABLE(
            HttpStatus.SERVICE_UNAVAILABLE,
            "GitHub 저장소 연결을 사용할 수 없습니다."
    ),

    GITHUB_INTEGRATION_NOT_FOUND(
            HttpStatus.NOT_FOUND,
            "사용 가능한 GitHub 저장소 연결을 찾을 수 없습니다."
    ),

    INVALID_REQUEST(
            HttpStatus.BAD_REQUEST,
            "요청 값이 올바르지 않습니다."
    ),

    SOLUTION_NOT_FOUND(
            HttpStatus.NOT_FOUND,
            "풀이를 찾을 수 없습니다."
    ),

    SOLUTION_CHANGED(
            HttpStatus.CONFLICT,
            "풀이가 변경되었습니다. 목록을 새로고침하고 공개할 내용을 다시 확인해 주세요."
    ),

    AI_ARTIFACT_NOT_FOUND(
            HttpStatus.NOT_FOUND,
            "AI 결과를 찾을 수 없습니다."
    ),

    DUPLICATE_SOLUTION(
            HttpStatus.CONFLICT,
            "이미 등록된 풀이입니다."
    ),

    PLATFORM_NOT_SUPPORTED(
            HttpStatus.BAD_REQUEST,
            "지원하지 않는 플랫폼입니다."
    ),

    CAPTURE_DATA_INVALID(
            HttpStatus.BAD_REQUEST,
            "수집 데이터가 올바르지 않습니다."
    ),

    EXTERNAL_API_ERROR(
            HttpStatus.BAD_GATEWAY,
            "외부 API 요청에 실패했습니다."
    ),

    RATE_LIMITED(
            HttpStatus.TOO_MANY_REQUESTS,
            "요청 횟수 제한을 초과했습니다."
    ),

    AI_RESPONSE_INVALID(
            HttpStatus.BAD_GATEWAY,
            "AI 응답 형식이 올바르지 않습니다."
    ),

    EXPORT_FAILED(
            HttpStatus.INTERNAL_SERVER_ERROR,
            "내보내기 작업에 실패했습니다."
    ),

    INTERNAL_ERROR(
            HttpStatus.INTERNAL_SERVER_ERROR,
            "서버 내부 오류가 발생했습니다."
    );

    private final HttpStatus status;
    private final String message;

    ErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getMessage() {
        return message;
    }
}
