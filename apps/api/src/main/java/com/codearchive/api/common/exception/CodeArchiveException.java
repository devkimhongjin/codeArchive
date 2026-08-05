package com.codearchive.api.common.exception;

public class CodeArchiveException extends RuntimeException {

    private final ErrorCode errorCode;

    public CodeArchiveException(ErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }

    public CodeArchiveException(
            ErrorCode errorCode,
            String message
    ) {
        super(message);
        this.errorCode = errorCode;
    }

    public ErrorCode getErrorCode() {
        return errorCode;
    }
}