package com.codearchive.api.integration.github;

import static org.assertj.core.api.Assertions.*;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

class GitHubUploadPathTest {
    @ParameterizedTest
    @CsvSource({"Java,java", "Python,py", "JavaScript,js", "TypeScript,ts", "C++,cpp", "Rust,txt"})
    void languageExtensionsMatchExistingExportAndRejectMismatchedOutput(String language, String extension) {
        assertThat(GitHubUploadPath.choose(null, "SWEA", "1206", language)).isEqualTo("SWEA/1206/Solution." + extension);
        assertThat(GitHubUploadPath.choose("풀이 모음/Custom." + extension, "SWEA", "1206", language))
                .isEqualTo("풀이 모음/Custom." + extension);
        invalid(() -> GitHubUploadPath.choose("Solution.exe", "SWEA", "1206", language));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "/Solution.java", "../Solution.java", "x/../Solution.java", "x//Solution.java",
            "x\\Solution.java", "x%2FSolution.java", ".git/Solution.java", ".GITHUB/workflows/Solution.java",
            "C:/Solution.java", "CON.java", "nul/Solution.java", "Lpt1.java", "x\u202E/Solution.java",
            "x\n/Solution.java", "x /Solution.java", "x./Solution.java", "x/Solution.java/",
            "a/b/c/d/e/f/g/h/i/Solution.java"})
    void rejectsTraversalReservedNamesWorkflowPathsAndUnsupportedDepth(String path) {
        invalid(() -> GitHubUploadPath.choose(path, "SWEA", "1206", "Java"));
    }

    @Test
    void boundsUseUtf8BytesWithoutNormalizingReviewedPathOrMessage() {
        assertThat(GitHubUploadPath.choose("a/b/c/d/e/f/g/h/Solution.java", "SWEA", "1206", "Java"))
                .isEqualTo("a/b/c/d/e/f/g/h/Solution.java");
        invalid(() -> GitHubUploadPath.choose("한".repeat(84) + ".java", "SWEA", "1206", "Java"));
        invalid(() -> GitHubUploadPath.choose(("a".repeat(250) + "/").repeat(4) + "LongFileNameSolution.java", "SWEA", "1206", "Java"));
        assertThat(GitHubUploadPath.commitMessage(" 풀이 추가 ", "SWEA", "1206")).isEqualTo(" 풀이 추가 ");
        invalid(() -> GitHubUploadPath.commitMessage("한".repeat(67), "SWEA", "1206"));
        invalid(() -> GitHubUploadPath.commitMessage("subject\nbody", "SWEA", "1206"));
        invalid(() -> GitHubUploadPath.commitMessage("hidden\u202Etext", "SWEA", "1206"));
        invalid(() -> GitHubUploadPath.commitMessage(" ", "SWEA", "1206"));
    }

    @Test
    void sourceBearingRecordsHaveRedactedDiagnostics() {
        assertThat(new GitHubUploadPreviewService.CreationDiff("ADD_FILE", "", "source-canary").toString()).doesNotContain("source-canary");
        var request = new GitHubUploadPreviewService.Request(UUID.randomUUID(), Instant.now(), 1, 2, "main", "a".repeat(40),
                "path-canary.java", "message-canary");
        assertThat(request.toString()).doesNotContain("path-canary", "message-canary");
    }

    private void invalid(Runnable action) {
        assertThatThrownBy(action::run).isInstanceOf(CodeArchiveException.class)
                .satisfies(failure -> assertThat(((CodeArchiveException) failure).getErrorCode()).isEqualTo(ErrorCode.INVALID_REQUEST));
    }
}
