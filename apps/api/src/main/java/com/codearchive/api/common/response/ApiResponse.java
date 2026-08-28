package com.codearchive.api.common.response;

public record ApiResponse<T>(
        boolean success,
        T data,
        ApiError error,
        String requestId
) {
    public static <T> ApiResponse<T> success(
            T data,
            String requestId
    ) {
        return new ApiResponse<>(
                true,
                data,
                null,
                requestId
        );
    }

    public static <T> ApiResponse<T> failure(
            ApiError error,
            String requestId
    ) {
        return new ApiResponse<>(
                false,
                null,
                error,
                requestId
        );
    }
}