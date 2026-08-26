package com.codearchive.api.ai;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import com.codearchive.api.ai.AnalysisClient.AnalysisRequest;
import com.codearchive.api.ai.AnalysisClient.AnalysisResult;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;
import com.codearchive.api.solution.Solution;
import com.codearchive.api.solution.SolutionRepository;

@Service
public class AiArtifactService {

    private final SolutionRepository solutionRepository;
    private final AiArtifactRepository artifactRepository;
    private final AiQuotaService quotaService;
    private final AnalysisClient analysisClient;

    public AiArtifactService(
            SolutionRepository solutionRepository,
            AiArtifactRepository artifactRepository,
            AiQuotaService quotaService,
            AnalysisClient analysisClient
    ) {
        this.solutionRepository = solutionRepository;
        this.artifactRepository = artifactRepository;
        this.quotaService = quotaService;
        this.analysisClient = analysisClient;
    }

    public AiArtifactResponse create(
            CodeArchivePrincipal principal,
            UUID solutionId,
            AiArtifactCreateRequest request
    ) {
        UUID userId = ownerId(principal);
        if (request == null || request.type() == null) {
            throw new CodeArchiveException(
                    ErrorCode.INVALID_REQUEST
            );
        }

        Solution solution = solutionRepository
                .findByIdAndUserId(solutionId, userId)
                .orElseThrow(() -> new CodeArchiveException(
                        ErrorCode.SOLUTION_NOT_FOUND
                ));

        quotaService.consume(userId);

        AnalysisResult result = analysisClient.analyze(
                new AnalysisRequest(
                        request.type(),
                        solution.getCode(),
                        solution.getPlatform(),
                        solution.getProblemNumber(),
                        solution.getTitle(),
                        solution.getLanguage()
                )
        );
        validateResult(result);

        AiArtifact artifact = artifactRepository.save(
                AiArtifact.create(
                        solution.getId(),
                        request.type(),
                        result.content(),
                        result.provider(),
                        result.model(),
                        Instant.now()
                )
        );

        return AiArtifactResponse.from(artifact);
    }

    public List<AiArtifactResponse> list(
            CodeArchivePrincipal principal,
            UUID solutionId
    ) {
        UUID userId = ownerId(principal);

        if (solutionRepository
                .findByIdAndUserId(solutionId, userId)
                .isEmpty()) {
            throw new CodeArchiveException(
                    ErrorCode.SOLUTION_NOT_FOUND
            );
        }

        return artifactRepository
                .findOwnedBySolutionId(solutionId, userId)
                .stream()
                .map(AiArtifactResponse::from)
                .toList();
    }

    public AiArtifactResponse get(
            CodeArchivePrincipal principal,
            UUID artifactId
    ) {
        UUID userId = ownerId(principal);

        return artifactRepository
                .findOwnedById(artifactId, userId)
                .map(AiArtifactResponse::from)
                .orElseThrow(() -> new CodeArchiveException(
                        ErrorCode.AI_ARTIFACT_NOT_FOUND
                ));
    }

    private UUID ownerId(CodeArchivePrincipal principal) {
        if (principal == null) {
            throw new CodeArchiveException(
                    ErrorCode.AUTH_REQUIRED
            );
        }
        return principal.userId();
    }

    private void validateResult(AnalysisResult result) {
        if (result == null
                || !StringUtils.hasText(result.content())
                || !StringUtils.hasText(result.provider())
                || !StringUtils.hasText(result.model())) {
            throw new CodeArchiveException(
                    ErrorCode.AI_RESPONSE_INVALID
            );
        }
    }
}
