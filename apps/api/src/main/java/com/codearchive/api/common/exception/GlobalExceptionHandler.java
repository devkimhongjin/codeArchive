package com.codearchive.api.common.exception;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiError;
import com.codearchive.api.common.response.ApiResponse;

import jakarta.servlet.http.HttpServletRequest;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(CodeArchiveException.class)
    public ResponseEntity<ApiResponse<Void>> handleCodeArchiveException(
            CodeArchiveException exception,
            HttpServletRequest request
    ) {
        ErrorCode errorCode = exception.getErrorCode();

        ApiError error = ApiError.of(
                errorCode.name(),
                exception.getMessage()
        );

        return ResponseEntity
                .status(errorCode.getStatus())
                .body(ApiResponse.failure(
                        error,
                        getRequestId(request)
                ));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidationException(
            MethodArgumentNotValidException exception,
            HttpServletRequest request
    ) {
        Map<String, Object> details = new LinkedHashMap<>();

        for (FieldError fieldError :
                exception.getBindingResult().getFieldErrors()) {

            details.put(
                    fieldError.getField(),
                    fieldError.getDefaultMessage()
            );
        }

        ApiError error = ApiError.of(
                ErrorCode.INVALID_REQUEST.name(),
                ErrorCode.INVALID_REQUEST.getMessage(),
                details
        );

        return ResponseEntity
                .badRequest()
                .body(ApiResponse.failure(
                        error,
                        getRequestId(request)
                ));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnexpectedException(
            Exception exception,
            HttpServletRequest request
    ) {
        ApiError error = ApiError.of(
                ErrorCode.INTERNAL_ERROR.name(),
                ErrorCode.INTERNAL_ERROR.getMessage()
        );

        return ResponseEntity
                .status(ErrorCode.INTERNAL_ERROR.getStatus())
                .body(ApiResponse.failure(
                        error,
                        getRequestId(request)
                ));
    }

    private String getRequestId(HttpServletRequest request) {
        Object requestId = request.getAttribute(
                RequestIdFilter.REQUEST_ID_ATTRIBUTE
        );

        return requestId == null
                ? "unknown"
                : requestId.toString();
    }
}