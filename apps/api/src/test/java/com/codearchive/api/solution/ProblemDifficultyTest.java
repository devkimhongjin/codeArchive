package com.codearchive.api.solution;
import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;
class ProblemDifficultyTest {
    @Test void acceptsOnlyBoundOfficialScales() {
        String pg = "https://school.programmers.co.kr/learn/courses/30/lessons/123";
        var value = new ProblemDifficulty("Lv. 3", "123", "https://school.programmers.co.kr/learn/challenges");
        assertThat(ProblemDifficulty.validated(Platform.PROGRAMMERS, "123", pg, value)).isEqualTo(value);
        assertThat(ProblemDifficulty.validated(Platform.PROGRAMMERS, "124", pg, value)).isNull();
        assertThat(ProblemDifficulty.validated(Platform.PROGRAMMERS, "123", pg, new ProblemDifficulty("Lv. 6", "123", value.sourceUrl()))).isNull();
        assertThat(ProblemDifficulty.validated(Platform.PROGRAMMERS, "123", pg, new ProblemDifficulty("Lv. 3", "123", "https://evil.test/learn/challenges"))).isNull();
        assertThat(ProblemDifficulty.validated(Platform.JUNGOL, "123", "https://jungol.co.kr/problem/123", new ProblemDifficulty("Gold I", "123", "https://solved.ac/problem/123"))).isNull();
    }
    @Test void bindsSweaContestIdentityWithoutInventedBackfill() {
        String url = "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=VerifiedKey";
        var value = new ProblemDifficulty("D3", "123", url);
        assertThat(ProblemDifficulty.validated(Platform.SWEA, "123", url, value)).isEqualTo(value);
        assertThat(ProblemDifficulty.validated(Platform.SWEA, "123", url, new ProblemDifficulty("D3", "123", url + "&contestProbId=Other"))).isNull();
        assertThat(ProblemDifficulty.validated(Platform.SWEA, "123", url, null)).isNull();
    }
}
