package com.codearchive.api.support;

import com.codearchive.api.auth.AppUser;

/** Immutable GitHub account authority for the private support inbox. */
public final class SupportAdminPolicy {
    public static final String ADMIN_GITHUB_ID = "301944193";
    private SupportAdminPolicy() {}
    public static boolean isAdmin(String authenticatedGithubId, AppUser persistedUser) {
        return persistedUser != null && ADMIN_GITHUB_ID.equals(authenticatedGithubId)
                && ADMIN_GITHUB_ID.equals(persistedUser.getGithubId());
    }
}
