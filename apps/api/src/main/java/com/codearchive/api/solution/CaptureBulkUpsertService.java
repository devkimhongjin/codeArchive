package com.codearchive.api.solution;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;

import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

@Service
public class CaptureBulkUpsertService {

    private static final int MAX_BATCH_SIZE = 25;
    private static final String SUPPORTED_PLATFORM = "SWEA";
    private static final String ACCEPTED_RESULT = "ACCEPTED";
    private static final String DEFAULT_AI_USAGE = "unknown";
    private static final Set<String> AI_USAGE_VALUES = Set.of(
            "used",
            "not_used",
            "unknown"
    );

    private final CaptureImportPersistenceService persistenceService;
    private final Clock clock;

    @Autowired
    public CaptureBulkUpsertService(
            CaptureImportPersistenceService persistenceService
    ) {
        this(persistenceService, Clock.systemUTC());
    }

    CaptureBulkUpsertService(
            CaptureImportPersistenceService persistenceService,
            Clock clock
    ) {
        this.persistenceService = persistenceService;
        this.clock = clock;
    }

    public CaptureBulkUpsertResponse bulkUpsert(
            CodeArchivePrincipal principal,
            CaptureBulkUpsertRequest request
    ) {
        UUID userId = ownerId(principal);
        List<CaptureBulkUpsertRequest.CaptureItem> records =
                requireBoundedRecords(request);

        List<String> clientRecordIds = records.stream()
                .map(item -> requireClientRecordId(
                        item == null ? null : item.clientRecordId()
                ))
                .toList();

        List<CaptureBulkUpsertResponse.ItemResult> results =
                new ArrayList<>(records.size());

        for (int index = 0; index < records.size(); index++) {
            CaptureBulkUpsertRequest.CaptureItem item = records.get(index);
            String clientRecordId = clientRecordIds.get(index);

            try {
                SolutionUpsertRepository.Values values = normalize(item);
                CaptureBulkUpsertResponse.Outcome outcome =
                        persistenceService.persist(
                                userId,
                                clientRecordId,
                                values,
                                clock.instant()
                        );

                results.add(outcome
                        == CaptureBulkUpsertResponse.Outcome.IMPORTED
                        ? CaptureBulkUpsertResponse.ItemResult.imported(
                                clientRecordId
                        )
                        : CaptureBulkUpsertResponse.ItemResult.existing(
                                clientRecordId
                        ));
            } catch (CodeArchiveException exception) {
                results.add(CaptureBulkUpsertResponse.ItemResult.failed(
                        clientRecordId,
                        "INVALID_RECORD"
                ));
            } catch (DataAccessException exception) {
                results.add(CaptureBulkUpsertResponse.ItemResult.failed(
                        clientRecordId,
                        "PERSISTENCE_FAILED"
                ));
            }
        }

        return new CaptureBulkUpsertResponse(List.copyOf(results));
    }

    private UUID ownerId(CodeArchivePrincipal principal) {
        if (principal == null) {
            throw new CodeArchiveException(ErrorCode.AUTH_REQUIRED);
        }
        return principal.userId();
    }

    private List<CaptureBulkUpsertRequest.CaptureItem> requireBoundedRecords(
            CaptureBulkUpsertRequest request
    ) {
        if (request == null
                || request.records() == null
                || request.records().isEmpty()
                || request.records().size() > MAX_BATCH_SIZE) {
            throw invalidRequest();
        }
        return request.records();
    }

    private String requireClientRecordId(String value) {
        return requiredTrimmed(value, 128);
    }

    private SolutionUpsertRepository.Values normalize(
            CaptureBulkUpsertRequest.CaptureItem item
    ) {
        if (item == null) {
            throw invalidRequest();
        }

        return new SolutionUpsertRepository.Values(
                normalizePlatform(item.platform()),
                requiredTrimmed(item.problemNumber(), 64),
                requiredTrimmed(item.title(), 255),
                requiredTrimmed(item.language(), 64),
                requiredCode(item.code()),
                normalizeResult(item.result()),
                item.solvedAt(),
                item.observedAt(),
                optionalTrimmed(item.executionTime(), 128),
                optionalTrimmed(item.memoryUsage(), 128),
                normalizeAiUsage(item.aiUsage())
        );
    }

    private String normalizePlatform(String value) {
        String platform = value == null || value.isBlank()
                ? SUPPORTED_PLATFORM
                : value.trim();
        if (!SUPPORTED_PLATFORM.equals(platform)) {
            throw new CodeArchiveException(
                    ErrorCode.PLATFORM_NOT_SUPPORTED
            );
        }
        return platform;
    }

    private String normalizeResult(String value) {
        String result = requiredTrimmed(value, 32);
        if (!ACCEPTED_RESULT.equals(result)) {
            throw new CodeArchiveException(
                    ErrorCode.CAPTURE_DATA_INVALID
            );
        }
        return result;
    }

    private String normalizeAiUsage(String value) {
        String aiUsage = value == null || value.isBlank()
                ? DEFAULT_AI_USAGE
                : value.trim();
        if (!AI_USAGE_VALUES.contains(aiUsage)) {
            throw invalidRequest();
        }
        return aiUsage;
    }

    private String requiredTrimmed(String value, int maxLength) {
        if (value == null) {
            throw invalidRequest();
        }
        String normalized = value.trim();
        if (normalized.isEmpty() || normalized.length() > maxLength) {
            throw invalidRequest();
        }
        return normalized;
    }

    private String requiredCode(String value) {
        if (value == null
                || value.isBlank()
                || value.length() > 200_000) {
            throw invalidRequest();
        }
        return value;
    }

    private String optionalTrimmed(String value, int maxLength) {
        if (value == null) {
            return null;
        }
        String normalized = value.trim();
        if (normalized.isEmpty()) {
            return null;
        }
        if (normalized.length() > maxLength) {
            throw invalidRequest();
        }
        return normalized;
    }

    private CodeArchiveException invalidRequest() {
        return new CodeArchiveException(ErrorCode.INVALID_REQUEST);
    }
}
