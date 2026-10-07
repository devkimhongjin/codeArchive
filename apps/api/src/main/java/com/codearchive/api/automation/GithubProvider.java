package com.codearchive.api.automation;
import com.codearchive.api.settings.UserSettings; import com.codearchive.api.solution.Solution;
public interface GithubProvider { Result createOnly(UserSettings settings, Solution solution);
 /** Invoked by concrete providers immediately before their visible final ref update. */
 default Result createOnly(UserSettings settings, Solution solution, FinalWriteGuard guard) { return createOnly(settings, solution); }
 @FunctionalInterface interface FinalWriteGuard { boolean stillAuthorized(); }
 record Result(Outcome outcome, String detail){ public static Result succeeded(){return new Result(Outcome.SUCCEEDED,"ok");} public static Result retryable(String d){return new Result(Outcome.RETRYABLE,d);} public static Result failed(String d){return new Result(Outcome.FAILED,d);} public static Result unknown(String d){return new Result(Outcome.UNKNOWN,d);} } enum Outcome { SUCCEEDED, RETRYABLE, FAILED, UNKNOWN } }
