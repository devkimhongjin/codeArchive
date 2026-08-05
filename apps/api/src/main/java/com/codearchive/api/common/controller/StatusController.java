package com.codearchive.api.common.controller;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiResponse;

@RestController
@RequestMapping("/api/v1")
public class StatusController {

    @GetMapping("/status")
    public ApiResponse<Map<String, String>> getStatus(
            @RequestAttribute(
                    RequestIdFilter.REQUEST_ID_ATTRIBUTE
            ) String requestId
    ) {
        return ApiResponse.success(
                Map.of(
                        "status", "UP",
                        "service", "codearchive-api"
                ),
                requestId
        );
    }
}