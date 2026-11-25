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
    @Test void bindsBaekjoonTierToThisProblemsSolvedAcEntry() {
        String source = "https://solved.ac/api/v3/problem/show?problemId=1000", problem = "https://acmicpc.net/problem/1000";
        var value = new ProblemDifficulty("Bronze V", "1000", source);
        assertThat(ProblemDifficulty.validated(Platform.BAEKJOON, "1000", problem, value)).isEqualTo(value);
        assertThat(ProblemDifficulty.validated(Platform.BAEKJOON, "1000", "https://www.acmicpc.net/problem/1000", value)).isEqualTo(value);
        assertThat(ProblemDifficulty.validated(Platform.BAEKJOON, "1000", problem, new ProblemDifficulty("Ruby I", "1000", source))).isNotNull();
        assertThat(ProblemDifficulty.validated(Platform.BAEKJOON, "1000", problem, new ProblemDifficulty("Gold 3", "1000", source))).isNull();
        assertThat(ProblemDifficulty.validated(Platform.BAEKJOON, "1000", problem, new ProblemDifficulty("Bronze V", "1000", source.replace("1000", "1001")))).isNull();
        assertThat(ProblemDifficulty.validated(Platform.BAEKJOON, "1000", problem, new ProblemDifficulty("Bronze V", "1000", source + "&x=1"))).isNull();
        assertThat(ProblemDifficulty.validated(Platform.BAEKJOON, "1000", "https://acmicpc.net/problem/1001", value)).isNull();
        assertThat(ProblemDifficulty.validated(Platform.BAEKJOON, "1000", problem, new ProblemDifficulty("Bronze V", "1000", "https://evil.test/api/v3/problem/show?problemId=1000"))).isNull();
        assertThat(ProblemDifficulty.validated(Platform.JUNGOL, "1000", "https://jungol.co.kr/problem/1000", value)).isNull();
    }
    @Test void bindsJungolOwnTierToItsProblemPage() {
        String url = "https://jungol.co.kr/problem/1006";
        var value = new ProblemDifficulty("Gold II", "1006", url);
        assertThat(ProblemDifficulty.validated(Platform.JUNGOL, "1006", url, value)).isEqualTo(value);
        assertThat(ProblemDifficulty.validated(Platform.JUNGOL, "1006", url, new ProblemDifficulty("Gold 2", "1006", url))).isNull();
        assertThat(ProblemDifficulty.validated(Platform.JUNGOL, "1006", url, new ProblemDifficulty("Gold II", "1006", "https://jungol.co.kr/problem/1007"))).isNull();
        assertThat(ProblemDifficulty.validated(Platform.JUNGOL, "1006", url, new ProblemDifficulty("Gold II", "1006", "https://solved.ac/api/v3/problem/show?problemId=1006"))).isNull();
        assertThat(ProblemDifficulty.validated(Platform.JUNGOL, "1006", "https://jungol.co.kr/problem/1007", value)).isNull();
        assertThat(ProblemDifficulty.validated(Platform.BAEKJOON, "1006", "https://acmicpc.net/problem/1006", value)).isNull();
    }
    @Test void bindsSweaContestIdentityWithoutInventedBackfill() {
        String url = "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=VerifiedKey";
        var value = new ProblemDifficulty("D3", "123", url);
        assertThat(ProblemDifficulty.validated(Platform.SWEA, "123", url, value)).isEqualTo(value);
        assertThat(ProblemDifficulty.validated(Platform.SWEA, "123", url, new ProblemDifficulty("D3", "123", url + "&contestProbId=Other"))).isNull();
        assertThat(ProblemDifficulty.validated(Platform.SWEA, "123", url, null)).isNull();
    }
}
