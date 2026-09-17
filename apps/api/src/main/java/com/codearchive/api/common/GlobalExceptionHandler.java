package com.codearchive.api.common;

import jakarta.servlet.http.HttpServletRequest;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import jakarta.persistence.OptimisticLockException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException exception) {
        String message = exception.getBindingResult().getFieldErrors().stream()
                .map(this::formatFieldError)
                .collect(Collectors.joining(", "));
        return ResponseEntity.badRequest().body(new ApiError(message.isBlank() ? "Invalid request" : message));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiError> handleUnreadable(HttpMessageNotReadableException exception) {
        return ResponseEntity.badRequest().body(new ApiError("Request body is invalid"));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ApiError> handleDataIntegrity(DataIntegrityViolationException exception) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(new ApiError("Request conflicts with existing data"));
    }

    @ExceptionHandler({OptimisticLockException.class, ObjectOptimisticLockingFailureException.class})
    ResponseEntity<ApiError> handleOptimisticConflict(Exception exception) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(new ApiError("Settings changed; refresh and retry"));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<ApiError> handleIllegalArgument(IllegalArgumentException exception) {
        String message = exception.getMessage() == null ? "Invalid request" : exception.getMessage();
        return ResponseEntity.badRequest().body(new ApiError(message));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> handleUnexpected(Exception exception, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ApiError("Unexpected server error"));
    }

    private String formatFieldError(FieldError error) {
        return error.getField() + ": " + (error.getDefaultMessage() == null ? "is invalid" : error.getDefaultMessage());
    }
}
