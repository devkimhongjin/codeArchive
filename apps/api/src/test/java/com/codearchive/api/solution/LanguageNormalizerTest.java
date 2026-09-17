package com.codearchive.api.solution;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class LanguageNormalizerTest {
    @ParameterizedTest
    @CsvSource({
            "Java,java",
            "JAVA,java",
            "Java 17,java",
            "'JAVA (OpenJDK 8)',java",
            "JavaScript,javascript",
            "Python3,python",
            "PyPy3,python",
            "C++17,cpp",
            "'C# 10',csharp"
    })
    void normalizesKnownPlatformAliases(String raw, String expected) {
        assertThat(LanguageNormalizer.canonicalKey(raw)).isEqualTo(expected);
    }

    @Test
    void keepsUnknownLanguagesInAnExplicitNamespace() {
        assertThat(LanguageNormalizer.canonicalKey("Brainf***")).startsWith("unknown:");
    }
}
