package com.codearchive.api.settings;

import java.util.Set;

/**
 * What an automatic commit does when the same problem is accepted again in the
 * same language. Manual and historical batch commits are explicit choices and
 * are not affected.
 */
public final class GithubDuplicateCommits {
    /** Every accepted submission is committed (the behaviour before this setting existed). */
    public static final String ALL = "ALL";
    /** Only the first accepted submission is committed; later ones stay on the server only. */
    public static final String FIRST_ACCEPTED = "FIRST_ACCEPTED";
    private static final Set<String> VALUES = Set.of(ALL, FIRST_ACCEPTED);

    private GithubDuplicateCommits() {
    }

    public static boolean valid(String value) {
        return VALUES.contains(value);
    }
}
