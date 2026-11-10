package com.codearchive.api.automation;

import static org.assertj.core.api.Assertions.assertThat;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.auth.UserRepository;
import com.codearchive.api.solution.Platform;
import com.codearchive.api.solution.Solution;
import com.codearchive.api.solution.SolutionRepository;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest @ActiveProfiles("test")
class GithubDuplicateCommitQueryTest {
  @Autowired UserRepository users; @Autowired SolutionRepository solutions; @Autowired GithubCommitJobRepository jobs;
  private AppUser owner, other;

  @AfterEach void cleanup() {
    for (AppUser user : new AppUser[] {owner, other}) {
      if (user == null) continue;
      jobs.deleteAll(jobs.findAll().stream().filter(job -> job.getUser().getId().equals(user.getId())).toList());
      solutions.deleteAll(solutions.findByUserIdOrderBySolvedAtDesc(user.getId()));
      users.delete(user);
    }
  }

  @Test void onlyAnotherNonFailedJobOfTheSameProblemAndLanguageCounts() {
    owner = users.saveAndFlush(AppUser.fromGithub("720", "user720", null, null));
    other = users.saveAndFlush(AppUser.fromGithub("721", "user721", null, null));
    String first = solution(owner, "299305", "MySQL"), again = solution(owner, "299305", "MySQL");
    String java = solution(owner, "299305", "Java"), foreign = solution(other, "299305", "MySQL");

    assertThat(exists(owner, "299305", "sql", again)).isFalse();
    GithubCommitJob firstJob = jobs.saveAndFlush(new GithubCommitJob(owner, first, 1));
    assertThat(exists(owner, "299305", "sql", again)).isTrue();
    // The submission's own job, another language, another problem and another account do not count.
    assertThat(exists(owner, "299305", "sql", first)).isFalse();
    assertThat(exists(owner, "299305", "java", java)).isFalse();
    assertThat(exists(owner, "299306", "sql", again)).isFalse();
    jobs.saveAndFlush(new GithubCommitJob(other, foreign, 1));
    assertThat(exists(other, "299305", "sql", foreign)).isFalse();
    // A failed commit wrote nothing, so the next acceptance may still be committed; UNKNOWN may have.
    firstJob.terminal(CommitJobState.FAILED); jobs.saveAndFlush(firstJob);
    assertThat(exists(owner, "299305", "sql", again)).isFalse();
    firstJob.terminal(CommitJobState.UNKNOWN); jobs.saveAndFlush(firstJob);
    assertThat(exists(owner, "299305", "sql", again)).isTrue();
  }

  private boolean exists(AppUser user, String problem, String languageKey, String captureId) {
    return jobs.existsCommitForProblem(user.getId(), Platform.PROGRAMMERS, problem, languageKey, captureId, CommitJobState.FAILED);
  }

  private String solution(AppUser user, String problem, String language) {
    String capture = UUID.randomUUID().toString(); Instant now = Instant.now();
    solutions.saveAndFlush(new Solution(user, capture, Platform.PROGRAMMERS, problem, "Title", "https://school.programmers.co.kr/", language, "SELECT 1", "ACCEPTED", now, now, null, null));
    return capture;
  }
}
