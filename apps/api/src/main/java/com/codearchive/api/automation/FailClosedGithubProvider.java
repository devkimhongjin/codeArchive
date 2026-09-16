package com.codearchive.api.automation;
import com.codearchive.api.settings.UserSettings; import com.codearchive.api.solution.Solution;
public class FailClosedGithubProvider implements GithubProvider { public Result createOnly(UserSettings settings,Solution solution){ return Result.failed("GitHub App configuration is unavailable"); } }
