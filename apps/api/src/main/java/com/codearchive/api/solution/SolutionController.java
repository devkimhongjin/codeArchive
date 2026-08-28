package com.codearchive.api.solution;

import java.util.List;
import java.util.UUID;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.filter.RequestIdFilter;
import com.codearchive.api.common.response.ApiResponse;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@RestController
@RequestMapping("/api/v1/solutions")
@Validated
public class SolutionController {

    private final SolutionService solutionService;

    public SolutionController(SolutionService solutionService) {
        this.solutionService = solutionService;
    }

    @PutMapping("/by-client-id/{clientRecordId}")
    public ApiResponse<SolutionResponse> upsert(
            @AuthenticationPrincipal CodeArchivePrincipal principal,
            @PathVariable
            @NotBlank
            @Size(max = 128)
            String clientRecordId,
            @Valid @RequestBody SolutionUpsertRequest request,
            @RequestAttribute(
                    RequestIdFilter.REQUEST_ID_ATTRIBUTE
            ) String requestId
    ) {
        return ApiResponse.success(
                solutionService.upsert(
                        principal,
                        clientRecordId,
                        request
                ),
                requestId
        );
    }

    @GetMapping("/{id}")
    public ApiResponse<SolutionResponse> get(
            @AuthenticationPrincipal CodeArchivePrincipal principal,
            @PathVariable UUID id,
            @RequestAttribute(
                    RequestIdFilter.REQUEST_ID_ATTRIBUTE
            ) String requestId
    ) {
        return ApiResponse.success(
                solutionService.get(principal, id),
                requestId
        );
    }

    @GetMapping
    public ApiResponse<List<SolutionResponse>> list(
            @AuthenticationPrincipal CodeArchivePrincipal principal,
            @RequestParam(defaultValue = "50")
            @Min(1)
            @Max(100)
            int limit,
            @RequestAttribute(
                    RequestIdFilter.REQUEST_ID_ATTRIBUTE
            ) String requestId
    ) {
        return ApiResponse.success(
                solutionService.list(principal, limit),
                requestId
        );
    }
}
