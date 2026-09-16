package com.codearchive.api.common;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.auth.GithubAuthentication;
import com.codearchive.api.auth.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;

/**
 * Binds a Dashboard request to the immutable GitHub identity it rendered for.
 * The header is an assertion, never authentication: an authenticated GitHub
 * session and a persisted AppUser are both required before it is compared.
 */
public final class GithubAccountAssertion {
  public static final String HEADER = "X-CodeArchive-Github-Id";
  private GithubAccountAssertion() {}

  public record Account(AppUser user, String githubId) {}
  public record Checked(Account account, ResponseEntity<?> failure) {
    public boolean accepted() { return account != null; }
  }

  public static Checked require(Authentication authentication, String expectedGithubId, UserRepository users) {
    var identity = GithubAuthentication.identity(authentication);
    if (identity.isEmpty()) return rejected(401, "Authentication is required");
    AppUser user = users.findByGithubId(identity.get().githubId()).orElse(null);
    if (user == null) return rejected(401, "Authentication is required");
    if (expectedGithubId == null || !expectedGithubId.matches("[1-9][0-9]{0,19}")) {
      return rejected(400, "Expected GitHub account is required");
    }
    byte[] expected = expectedGithubId.getBytes(StandardCharsets.US_ASCII);
    byte[] actual = identity.get().githubId().getBytes(StandardCharsets.US_ASCII);
    if (!MessageDigest.isEqual(expected, actual)) return rejected(409, "GitHub account changed; reconnect required");
    return new Checked(new Account(user, identity.get().githubId()), null);
  }

  private static Checked rejected(int status, String message) {
    return new Checked(null, ResponseEntity.status(status).body(new ApiError(message)));
  }
}
