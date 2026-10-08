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
import org.springframework.web.bind.annotation.RequestParam;
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

    @GetMapping("/historical-submission-ids")
    public ResponseEntity<?> historicalSubmissionIds(
            Authentication authentication,
            @RequestHeader(value = "X-CodeArchive-Account", required = false) String accountAssertion,
            @RequestParam(defaultValue = "JUNGOL") String platform) {
        Optional<GithubIdentity> identity = GithubAuthentication.identity(authentication);
        if (identity.isEmpty()) return ResponseEntity.status(401).body(new ApiError("Authentication is required"));
        ResponseEntity<?> assertionFailure = validateAccountAssertion(identity.get().githubId(), accountAssertion);
        if (assertionFailure != null) return assertionFailure;
        try {
            return ResponseEntity.ok(solutionService.historicalSubmissionIdsForUser(identity.get().githubId(), Platform.valueOf(platform)));
        } catch (IllegalArgumentException exception) {
            return ResponseEntity.badRequest().body(new ApiError("Unsupported platform"));
        }
    }

    @GetMapping("/historical-github-status")
    public ResponseEntity<?> historicalGithubStatus(
            Authentication authentication,
            @RequestHeader(value = "X-CodeArchive-Account", required = false) String accountAssertion) {
        Optional<GithubIdentity> identity = GithubAuthentication.identity(authentication);
        if (identity.isEmpty()) return ResponseEntity.status(401).body(new ApiError("Authentication is required"));
        ResponseEntity<?> assertionFailure = validateAccountAssertion(identity.get().githubId(), accountAssertion);
        if (assertionFailure != null) return assertionFailure;
        List<Solution> historical = solutionService.listForUser(identity.get().githubId()).stream()
                .filter(solution -> solution.getPlatform() == Platform.JUNGOL && solution.isHistoricalImport() &&
                        solution.getHistoricalSubmissionId() != null).toList();
        if (historical.isEmpty()) return ResponseEntity.ok(java.util.Map.of());
        var states = automation.statuses(historical.get(0).getUser(), historical.stream().map(Solution::getCaptureId).toList());
        java.util.Map<String, String> result = new java.util.LinkedHashMap<>();
        for (Solution solution : historical) {
            var state = states.get(solution.getCaptureId());
            result.put(solution.getHistoricalSubmissionId(), state == null ? "NONE" : state.name());
        }
        return ResponseEntity.ok(result);
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
                acceptedCaptureIds.add(payload.getCaptureId());
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

    @PostMapping("/historical-github-commits")
    public ResponseEntity<?> manualHistoricalGithubCommits(
            @RequestBody JsonNode body,
            Authentication authentication,
            @RequestHeader(value = "X-CodeArchive-Account", required = false) String accountAssertion) {
        Optional<GithubIdentity> identity = GithubAuthentication.identity(authentication);
        if (identity.isEmpty()) return ResponseEntity.status(401).body(new ApiError("Authentication is required"));
        String githubId = identity.get().githubId();
        ResponseEntity<?> assertionFailure = validateAccountAssertion(githubId, accountAssertion);
        if (assertionFailure != null) return assertionFailure;
        if (body == null || !body.isObject() || !body.path("submissionIds").isArray() ||
                body.path("submissionIds").size() < 1 || body.path("submissionIds").size() > 50 ||
                !body.path("settingsVersion").isIntegralNumber() || !body.path("installationId").isIntegralNumber() ||
                !body.path("owner").isTextual() || !body.path("repository").isTextual() || !body.path("branch").isTextual())
            return ResponseEntity.badRequest().body(new ApiError("Invalid manual commit request"));
        List<String> ids = new ArrayList<>();
        for (JsonNode id : body.path("submissionIds")) {
            if (!id.isTextual() || !id.asText().matches("[0-9]{1,40}"))
                return ResponseEntity.badRequest().body(new ApiError("Invalid submission ID"));
            ids.add(id.asText());
        }
        if (new LinkedHashSet<>(ids).size() != ids.size())
            return ResponseEntity.badRequest().body(new ApiError("Duplicate submission ID"));
        List<Solution> owned = solutionService.listForUser(githubId);
        List<Solution> selected = new ArrayList<>();
        for (String id : ids) {
            Optional<Solution> match = owned.stream().filter(solution -> solution.getPlatform() == Platform.JUNGOL &&
                    solution.isHistoricalImport() && id.equals(solution.getHistoricalSubmissionId())).findFirst();
            if (match.isEmpty()) return ResponseEntity.status(409).body(new ApiError("Historical submission is not synced"));
            selected.add(match.get());
        }
        try {
            return ResponseEntity.ok(automation.requestManualHistorical(selected,
                    body.path("settingsVersion").asLong(), body.path("installationId").asLong(),
                    body.path("owner").asText(), body.path("repository").asText(), body.path("branch").asText()));
        } catch (CaptureValidationException exception) {
            return ResponseEntity.status(409).body(new ApiError(exception.getMessage()));
        }
    }

    @GetMapping("/historical-github-candidates")
    public ResponseEntity<?> historicalGithubCandidates(Authentication authentication,
            @RequestHeader(value = "X-CodeArchive-Account", required = false) String assertion) {
        Optional<GithubIdentity> identity = GithubAuthentication.identity(authentication);
        if (identity.isEmpty()) return ResponseEntity.status(401).body(new ApiError("Authentication is required"));
        ResponseEntity<?> failure = validateAccountAssertion(identity.get().githubId(), assertion);
        if (failure != null) return failure;
        List<Solution> historical = solutionService.listForUser(identity.get().githubId()).stream()
                .filter(solution -> solution.isHistoricalImport() && solution.getHistoricalSubmissionId() != null).toList();
        if (historical.isEmpty()) return ResponseEntity.ok(List.of());
        var states = automation.statuses(historical.get(0).getUser(), historical.stream().map(Solution::getCaptureId).toList());
        return ResponseEntity.ok(historical.stream().map(solution -> HistoricalCommitCandidate.from(solution,
                states.containsKey(solution.getCaptureId()) ? states.get(solution.getCaptureId()).name() : "NONE")).toList());
    }

    @PostMapping("/historical-github-batch")
    public ResponseEntity<?> historicalGithubBatch(@RequestBody JsonNode body, Authentication authentication,
            @RequestHeader(value = "X-CodeArchive-Account", required = false) String assertion) {
        Optional<GithubIdentity> identity = GithubAuthentication.identity(authentication);
        if (identity.isEmpty()) return ResponseEntity.status(401).body(new ApiError("Authentication is required"));
        ResponseEntity<?> failure = validateAccountAssertion(identity.get().githubId(), assertion);
        if (failure != null) return failure;
        if (body == null || !body.isObject() || !body.path("captureIds").isArray() ||
                body.path("captureIds").size() < 1 || body.path("captureIds").size() > 50 ||
                !body.path("settingsVersion").isIntegralNumber() || !body.path("installationId").isIntegralNumber() ||
                !body.path("owner").isTextual() || !body.path("repository").isTextual() || !body.path("branch").isTextual())
            return ResponseEntity.badRequest().body(new ApiError("Invalid manual commit request"));
        List<String> ids = new ArrayList<>();
        for (JsonNode id : body.path("captureIds")) {
            if (!id.isTextual() || !id.asText().matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))
                return ResponseEntity.badRequest().body(new ApiError("Invalid capture ID"));
            ids.add(id.asText());
        }
        if (new LinkedHashSet<>(ids).size() != ids.size())
            return ResponseEntity.badRequest().body(new ApiError("Duplicate capture ID"));
        List<Solution> owned = solutionService.listForUser(identity.get().githubId());
        List<Solution> selected = new ArrayList<>();
        for (String id : ids) {
            Optional<Solution> match = owned.stream().filter(solution -> solution.isHistoricalImport() &&
                    solution.getHistoricalSubmissionId() != null && id.equals(solution.getCaptureId())).findFirst();
            if (match.isEmpty()) return ResponseEntity.status(409).body(new ApiError("Historical capture is not synced"));
            selected.add(match.get());
        }
        try {
            return ResponseEntity.ok(automation.requestManualHistoricalByCapture(selected,
                    body.path("settingsVersion").asLong(), body.path("installationId").asLong(),
                    body.path("owner").asText(), body.path("repository").asText(), body.path("branch").asText()));
        } catch (CaptureValidationException | DataIntegrityViolationException exception) {
            return ResponseEntity.status(409).body(new ApiError("GitHub request conflicts with current settings or job state; refresh and retry"));
        }
    }

    @PostMapping("/historical-github-reconcile")
    public ResponseEntity<?> reconcileHistorical(@RequestBody JsonNode body, Authentication authentication,
            @RequestHeader(value = "X-CodeArchive-Account", required = false) String assertion) {
        Optional<GithubIdentity> identity = GithubAuthentication.identity(authentication);
        if (identity.isEmpty()) return ResponseEntity.status(401).body(new ApiError("Authentication is required"));
        ResponseEntity<?> failure = validateAccountAssertion(identity.get().githubId(), assertion);
        if (failure != null) return failure;
        if (body == null || !body.isObject() || !body.path("captureId").isTextual()
                || !body.path("captureId").asText().matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
                || !body.path("settingsVersion").isIntegralNumber() || !body.path("retry").isBoolean())
            return ResponseEntity.badRequest().body(new ApiError("Invalid reconciliation request"));
        Optional<Solution> match = solutionService.listForUser(identity.get().githubId()).stream()
                .filter(item -> item.isHistoricalImport() && body.path("captureId").asText().equals(item.getCaptureId())).findFirst();
        if (match.isEmpty()) return ResponseEntity.status(404).body(new ApiError("Owned historical submission missing"));
        try {
            return ResponseEntity.ok(automation.reconcile(match.get(), body.path("settingsVersion").asLong(), body.path("retry").asBoolean()));
        } catch (CaptureValidationException exception) {
            return ResponseEntity.status(409).body(new ApiError(exception.getMessage()));
        }
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
