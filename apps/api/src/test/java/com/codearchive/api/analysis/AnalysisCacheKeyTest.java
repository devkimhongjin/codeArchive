package com.codearchive.api.analysis;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class AnalysisCacheKeyTest {
    @Test
    void sameCanonicalLanguageAndInputReuseTheSameKey() {
        String first = AnalysisCacheKey.forSource("JAVA 17", "class A {}", "checkstyle-1", "rules-1").orElseThrow();
        String second = AnalysisCacheKey.forSource("java", "class A {}", "checkstyle-1", "rules-1").orElseThrow();

        assertThat(first).isEqualTo(second).matches("[0-9a-f]{64}");
    }

    @Test
    void sourceAnalyzerAndConfigurationChangesInvalidateTheKey() {
        String baseline = AnalysisCacheKey.forSource("python", "print(1)", "ruff-1", "rules-1").orElseThrow();

        assertThat(AnalysisCacheKey.forSource("python", "print(2)", "ruff-1", "rules-1").orElseThrow()).isNotEqualTo(baseline);
        assertThat(AnalysisCacheKey.forSource("python", "print(1)", "ruff-2", "rules-1").orElseThrow()).isNotEqualTo(baseline);
        assertThat(AnalysisCacheKey.forSource("python", "print(1)", "ruff-1", "rules-2").orElseThrow()).isNotEqualTo(baseline);
    }

    @Test
    void lengthFramingPreventsAmbiguousFieldConcatenation() {
        String first = AnalysisCacheKey.forSource("typescript", "ab", "c", "d").orElseThrow();
        String second = AnalysisCacheKey.forSource("typescript", "a", "bc", "d").orElseThrow();

        assertThat(first).isNotEqualTo(second);
    }

    @Test
    void unsupportedLanguageOrUnversionedAnalyzerDoesNotProduceAKey() {
        assertThat(AnalysisCacheKey.forSource("C++17", "int main() {}", "tool-1", "rules-1")).isEmpty();
        assertThat(AnalysisCacheKey.forSource("JavaScript", "const x = 1", "", "rules-1")).isEmpty();
        assertThat(AnalysisCacheKey.forSource("Python", "print(1)", "ruff-1", " ")).isEmpty();
        assertThat(AnalysisCacheKey.forSource("Java", null, "checkstyle-1", "rules-1")).isEmpty();
    }
}
