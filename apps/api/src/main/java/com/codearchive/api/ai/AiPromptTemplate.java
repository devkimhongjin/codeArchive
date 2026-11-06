package com.codearchive.api.ai;

import com.codearchive.api.solution.Solution;
import java.math.BigDecimal;

/**
 * The only text that would leave the server for a model. It carries the
 * problem identity and the user's code, never the account, name, e-mail or
 * GitHub identity. Changing it requires a new {@link #VERSION}, which also
 * invalidates cached reviews.
 */
public final class AiPromptTemplate {
    public static final String VERSION = "code-review-v1";

    public record Prompt(String version, String instructions, String input) {}

    private static final String INSTRUCTIONS = String.join("\n",
            "당신은 알고리즘 풀이 코드 리뷰어입니다.",
            "이 풀이는 이미 채점에서 통과했습니다. 정답 여부를 다시 판단하지 마세요.",
            "코드를 실행하지 말고 읽기만 하세요.",
            "가독성, 시간·공간 복잡도, 자료구조 선택, 놓치기 쉬운 경계 조건을 기준으로 한국어로 답하세요.",
            "요약 한 문단과 구체적인 개선 제안 3~5개를 주세요. 코드 전체를 다시 쓰지 마세요.");

    private AiPromptTemplate() {
    }

    static Prompt build(Solution solution) {
        StringBuilder input = new StringBuilder()
                .append("플랫폼: ").append(solution.getPlatform().name()).append('\n')
                .append("문제: #").append(solution.getProblemNumber()).append(' ').append(solution.getTitle()).append('\n')
                .append("언어: ").append(solution.getLanguage()).append('\n');
        BigDecimal time = solution.getExecutionTime();
        if (time != null) input.append("실행 시간: ").append(time.stripTrailingZeros().toPlainString()).append(" ms\n");
        BigDecimal memory = solution.getMemoryValue();
        if (memory != null && solution.getMemoryUnit() != null) {
            input.append("메모리: ").append(memory.stripTrailingZeros().toPlainString()).append(' ').append(solution.getMemoryUnit()).append('\n');
        }
        input.append("\n코드:\n```\n").append(solution.getSourceCode()).append("\n```\n");
        return new Prompt(VERSION, INSTRUCTIONS, input.toString());
    }
}
