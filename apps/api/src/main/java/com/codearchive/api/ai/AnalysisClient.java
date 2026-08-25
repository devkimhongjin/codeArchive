package com.codearchive.api.ai;

public interface AnalysisClient {

    AnalysisResult analyze(AnalysisRequest request);

    record AnalysisRequest(
            AiArtifactType task,
            String code,
            String platform,
            String problemNumber,
            String title,
            String language
    ) {
    }

    record AnalysisResult(
            String content,
            String provider,
            String model
    ) {
    }
}
