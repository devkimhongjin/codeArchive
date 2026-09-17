package com.codearchive.api.automation;

/** Delivery boundary for a durable job id. Implementations never receive source or credentials. */
@FunctionalInterface
public interface GithubJobDispatcher {
    void dispatch(Long jobId);

    static GithubJobDispatcher noop() {
        return jobId -> { };
    }
}
