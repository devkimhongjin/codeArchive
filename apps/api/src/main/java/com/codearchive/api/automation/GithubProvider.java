package com.codearchive.api.automation;
import com.codearchive.api.settings.UserSettings;
import com.codearchive.api.solution.Solution;
public interface GithubProvider {
 Result createOnly(UserSettings settings, Solution solution);
 default Result createOnly(UserSettings settings, Solution solution, FinalWriteGuard guard) { return createOnly(settings, solution); }
 /** Digest of identity, destination, path and rendered content; never raw code. */
 default String recoveryContext(UserSettings settings, Solution solution) { return null; }
 /** Must not mutate repository contents or refs. */
 default Comparison compare(UserSettings settings, Solution solution) { return Comparison.UNAVAILABLE; }
 @FunctionalInterface interface FinalWriteGuard { boolean stillAuthorized(); }
 enum Comparison { MATCH, MISSING, CONFLICT, UNAVAILABLE }
 enum Diagnostic {
  OK, UNSPECIFIED, PREFLIGHT_UNAVAILABLE, BLOB_UNCONFIRMED, TREE_UNCONFIRMED,
  COMMIT_UNCONFIRMED, REF_UNCONFIRMED, BRANCH_CHANGED, FIRST_COMMIT_UNCONFIRMED,
  PROVIDER_EXCEPTION, LEASE_EXPIRED, TARGET_CHANGED;
  public boolean safeBeforeRef() { return this == BLOB_UNCONFIRMED || this == TREE_UNCONFIRMED || this == COMMIT_UNCONFIRMED || this == BRANCH_CHANGED; }
 }
 record Result(Outcome outcome, String detail, Diagnostic diagnostic) {
  public Result(Outcome outcome, String detail) { this(outcome, detail, Diagnostic.UNSPECIFIED); }
  public static Result succeeded() { return new Result(Outcome.SUCCEEDED, "ok", Diagnostic.OK); }
  public static Result retryable(String d) { return new Result(Outcome.RETRYABLE, d, Diagnostic.PREFLIGHT_UNAVAILABLE); }
  public static Result failed(String d) { return new Result(Outcome.FAILED, d, Diagnostic.UNSPECIFIED); }
  public static Result unknown(String d) { return new Result(Outcome.UNKNOWN, d, Diagnostic.UNSPECIFIED); }
  public static Result unknown(Diagnostic d) { return new Result(Outcome.UNKNOWN, "Outcome unconfirmed", d); }
 }
 enum Outcome { SUCCEEDED, RETRYABLE, FAILED, UNKNOWN }
}
