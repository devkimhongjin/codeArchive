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
