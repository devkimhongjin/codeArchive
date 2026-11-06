package com.codearchive.api.ai;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Deterministic stand-in for tests and local previews. It never sends code
 * anywhere. Marker comments in the code exercise the failure states.
 */
@Component
@ConditionalOnProperty(name = "codearchive.ai.provider", havingValue = "fake")
public class FakeAiReviewProvider implements AiReviewProvider {
    static final String BLOCK_MARKER = "codearchive-ai-fake:block";
    static final String TIMEOUT_MARKER = "codearchive-ai-fake:timeout";
    static final String FAIL_MARKER = "codearchive-ai-fake:fail";

    @Override public String name() { return "fake"; }
    @Override public String model() { return "fake-review-1"; }

    @Override
    public Result review(AiPromptTemplate.Prompt prompt, Duration timeout) throws ProviderException {
        String input = prompt.input();
        if (input.contains(TIMEOUT_MARKER)) throw new ProviderException("fake timeout", true);
        if (input.contains(FAIL_MARKER)) throw new ProviderException("fake failure", false);
        if (input.contains(BLOCK_MARKER)) return new Result(true, "", List.of());
        long lines = input.lines().count();
        return new Result(false,
                "가짜 공급자의 예시 결과입니다. 실제 모델은 연결되지 않았고, 입력 " + lines + "줄을 받았습니다.",
                List.of("변수 이름을 역할이 드러나게 바꿔 보세요.",
                        "입력 크기의 최댓값에서 시간 복잡도를 다시 확인해 보세요.",
                        "빈 입력이나 최솟값 같은 경계 조건을 점검해 보세요."));
    }
}
