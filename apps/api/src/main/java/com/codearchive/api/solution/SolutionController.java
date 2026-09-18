package com.codearchive.api.solution;

import com.codearchive.api.common.ApiError;
import com.codearchive.api.common.SafeFailureLogger;
import com.codearchive.api.auth.GithubAuthentication;
import com.codearchive.api.auth.GithubIdentity;
import com.codearchive.api.automation.GithubAutomationService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@RestController
@RequestMapping("/api/solutions")
public class SolutionController {
    private static final Logger LOGGER = LoggerFactory.getLogger(SolutionController.class);

    private final ObjectMapper objectMapper;
    private final SolutionService solutionService;
    private final GithubAutomationService automation;

    public SolutionController(ObjectMapper objectMapper, SolutionService solutionService,
                              GithubAutomationService automation) {
        this.objectMapper = objectMapper;
        this.solutionService = solutionService;
        this.automation = automation;
    }

    @GetMapping
    public ResponseEntity<?> list(
            Authentication authentication,
            @RequestHeader(value = "X-CodeArchive-Account", required = false) String accountAssertion) {
        Optional<GithubIdentity> identity = GithubAuthentication.identity(authentication);
        if (identity.isEmpty()) {
            return ResponseEntity.status(401).body(new ApiError("Authentication is required"));
        }
        String githubId = identity.get().githubId();
        ResponseEntity<?> assertionFailure = validateAccountAssertion(githubId, accountAssertion);
        if (assertionFailure != null) {
            return assertionFailure;
        }
        List<SolutionResponse> solutions = solutionService.listForUser(githubId).stream()
                .map(SolutionResponse::from)
                .toList();
        return ResponseEntity.ok(solutions);
    }

    @PostMapping("/bulk")
    public ResponseEntity<?> bulk(
            @RequestBody JsonNode body,
            Authentication authentication,
            @RequestHeader(value = "X-CodeArchive-Account", required = false) String accountAssertion) {
        Optional<GithubIdentity> identity = GithubAuthentication.identity(authentication);
        if (identity.isEmpty()) {
            return ResponseEntity.status(401).body(new ApiError("Authentication is required"));
        }
        String githubId = identity.get().githubId();
        ResponseEntity<?> assertionFailure = validateAccountAssertion(githubId, accountAssertion);
        if (assertionFailure != null) {
            return assertionFailure;
        }
        if (body == null || !body.isObject() || !body.has("captures") || !body.get("captures").isArray()) {
            return ResponseEntity.badRequest().body(new ApiError("captures must be an array"));
        }
        if (body.get("captures").size() > 50) {
            return ResponseEntity.badRequest().body(new ApiError("captures cannot contain more than 50 items"));
        }

        Set<String> acceptedCaptureIds = new LinkedHashSet<>();
        List<CaptureFailure> failures = new ArrayList<>();
        for (JsonNode node : body.get("captures")) {
            String rawCaptureId = extractCaptureId(node);
            try {
                CapturePayload payload = objectMapper.treeToValue(node, CapturePayload.class);
                Solution saved = saveWithOneRetry(githubId, payload);
                // Manual recovery and automatic relay must have identical
                // post-persistence semantics. The unique job constraint keeps
                // repeated syncs idempotent.
                automation.consider(saved.getUser(), saved);
                acceptedCaptureIds.add(saved.getCaptureId());
            } catch (CaptureValidationException exception) {
                failures.add(new CaptureFailure(rawCaptureId, exception.getMessage()));
            } catch (Exception exception) {
                if (exception instanceof DataIntegrityViolationException) {
                    SafeFailureLogger.databaseConstraint(LOGGER, rawCaptureId);
                } else {
                    SafeFailureLogger.unexpectedProcessingFailure(LOGGER, rawCaptureId);
                }
                failures.add(new CaptureFailure(rawCaptureId, "Capture could not be saved"));
            }
        }

        return ResponseEntity.ok(new BulkUpsertResponse(new ArrayList<>(acceptedCaptureIds), failures));
    }

    private Solution saveWithOneRetry(String githubId, CapturePayload payload) {
        try {
            return solutionService.upsert(githubId, payload);
        } catch (DataIntegrityViolationException firstFailure) {
            // A concurrent request may have created the unique (user,captureId) row after the initial lookup.
            // This controller method is non-transactional, so each proxied upsert call
            // has completed before this one-time concurrent-upsert retry begins.
            return solutionService.upsert(githubId, payload);
        }
    }

    private String extractCaptureId(JsonNode node) {
        if (node != null && node.isObject() && node.has("captureId") && !node.get("captureId").isNull()) {
            return node.get("captureId").asText();
        }
        return null;
    }

    private ResponseEntity<?> validateAccountAssertion(String githubId, String assertion) {
        if (assertion == null) {
            return null;
        }
        String expected = githubId.trim();
        String provided = assertion.trim();
        if (!expected.equals(provided)) {
            return ResponseEntity.status(409)
                    .body(new ApiError("Account context changed; refresh and retry"));
        }
        return null;
    }
}
