package com.codearchive.api.solution;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

@Service
public class SolutionService {

    private static final String DEFAULT_PLATFORM = "SWEA";
    private static final Set<String> SUPPORTED_PLATFORMS = Set.of(
            "SWEA",
            "PROGRAMMERS"
    );
    private static final String ACCEPTED_RESULT = "ACCEPTED";
    private static final String DEFAULT_AI_USAGE = "unknown";
    private static final Set<String> AI_USAGE_VALUES = Set.of(
            "used",
            "not_used",
            "unknown"
    );

    private final SolutionRepository solutionRepository;
    private final SolutionUpsertRepository upsertRepository;
    private final Clock clock;

    @Autowired
    public SolutionService(
            SolutionRepository solutionRepository,
            SolutionUpsertRepository upsertRepository
    ) {
        this(
                solutionRepository,
                upsertRepository,
                Clock.systemUTC()
        );
    }

    SolutionService(
            SolutionRepository solutionRepository,
            SolutionUpsertRepository upsertRepository,
            Clock clock
    ) {
        this.solutionRepository = solutionRepository;
        this.upsertRepository = upsertRepository;
        this.clock = clock;
    }

    @Transactional
    public SolutionResponse upsert(
            CodeArchivePrincipal principal,
            String rawClientRecordId,
            SolutionUpsertRequest request
    ) {
        UUID userId = ownerId(principal);
        String clientRecordId = normalizeClientRecordId(
                rawClientRecordId
        );
        SolutionUpsertRepository.Values values = normalize(request);
        Instant now = clock.instant();

        UUID id = upsertRepository.upsert(
                userId,
                clientRecordId,
                values,
                now
        );

        Solution solution = solutionRepository
                .findByIdAndUserId(id, userId)
                .orElseThrow(() -> new CodeArchiveException(
                        ErrorCode.SOLUTION_NOT_FOUND
                ));

        return SolutionResponse.from(solution);
    }

    @Transactional
    public void delete(
            CodeArchivePrincipal principal,
            UUID id
    ) {
        UUID userId = ownerId(principal);
        if (id == null || solutionRepository.deleteByIdAndUserId(
                id,
                userId
        ) != 1) {
            throw new CodeArchiveException(
                    ErrorCode.SOLUTION_NOT_FOUND
            );
        }
    }

    @Transactional(readOnly = true)
    public SolutionResponse get(
            CodeArchivePrincipal principal,
            UUID id
    ) {
        UUID userId = ownerId(principal);

        return solutionRepository
                .findByIdAndUserId(id, userId)
                .map(SolutionResponse::from)
                .orElseThrow(() -> new CodeArchiveException(
                        ErrorCode.SOLUTION_NOT_FOUND
                ));
    }

    @Transactional(readOnly = true)
    public List<SolutionResponse> list(
            CodeArchivePrincipal principal,
            int limit
    ) {
        UUID userId = ownerId(principal);

        return solutionRepository
                .findByUserIdOrderByObservedAtDescCreatedAtDesc(
                        userId,
                        PageRequest.of(0, limit)
                )
                .stream()
                .map(SolutionResponse::from)
                .toList();
    }

    private UUID ownerId(CodeArchivePrincipal principal) {
        if (principal == null) {
            throw new CodeArchiveException(
                    ErrorCode.AUTH_REQUIRED
            );
        }
        return principal.userId();
    }

    private String normalizeClientRecordId(String value) {
        if (value == null) {
            throw invalidRequest();
        }
        String normalized = value.trim();
        if (normalized.isEmpty() || normalized.length() > 128) {
            throw invalidRequest();
        }
        return normalized;
    }

    private SolutionUpsertRepository.Values normalize(
            SolutionUpsertRequest request
    ) {
        if (request == null) {
            throw invalidRequest();
        }

        String platform = normalizePlatform(request.platform());
        String result = normalizeResult(request.result());
        String aiUsage = normalizeAiUsage(request.aiUsage());
        String problemNumber = requiredTrimmed(
                request.problemNumber(),
                64
        );
        String title = requiredTrimmed(request.title(), 255);
        String language = requiredTrimmed(request.language(), 64);
        String code = requiredCode(request.code());

        return new SolutionUpsertRepository.Values(
                platform,
                problemNumber,
                title,
                language,
                code,
                result,
                request.solvedAt(),
                request.observedAt(),
                optionalTrimmed(request.executionTime(), 128),
                optionalTrimmed(request.memoryUsage(), 128),
                aiUsage
        );
    }

    private String normalizePlatform(String value) {
        String platform = value == null || value.isBlank()
                ? DEFAULT_PLATFORM
                : value.trim();
        if (!SUPPORTED_PLATFORMS.contains(platform)) {
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
        return new CodeArchiveException(
                ErrorCode.INVALID_REQUEST
        );
    }
}
