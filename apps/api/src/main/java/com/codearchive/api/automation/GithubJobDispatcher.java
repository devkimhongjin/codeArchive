package com.codearchive.api.automation;

/** Delivery boundary for a durable job id. Implementations never receive source or credentials. */
@FunctionalInterface
public interface GithubJobDispatcher {
    void dispatch(Long jobId);

    /** A new explicit retry must not reuse a completed Cloud Tasks name. */
    default void dispatch(Long jobId, int deliveryGeneration) { dispatch(jobId); }

    static GithubJobDispatcher noop() {
        return jobId -> { };
    }
}
