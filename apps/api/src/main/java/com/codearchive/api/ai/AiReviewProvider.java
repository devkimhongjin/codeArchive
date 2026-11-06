package com.codearchive.api.ai;

import java.time.Duration;
import java.util.List;

/**
 * A model that reviews one accepted solution. Only the fake provider exists;
 * connecting a real model means adding another implementation of this
 * interface, selected by {@code codearchive.ai.provider}.
 */
public interface AiReviewProvider {
    /** Stable provider identifier stored with each review, e.g. {@code fake}. */
    String name();

    /** Model identifier stored with each review and part of the cache key. */
    String model();

    /** Must return or throw within {@code timeout}; never retries on its own. */
    Result review(AiPromptTemplate.Prompt prompt, Duration timeout) throws ProviderException;

    /** {@code blocked} means the provider's safety filter refused to answer. */
    record Result(boolean blocked, String summary, List<String> suggestions) {}

    final class ProviderException extends Exception {
        private final boolean timedOut;

        public ProviderException(String message, boolean timedOut) {
            super(message);
            this.timedOut = timedOut;
        }

        public boolean timedOut() { return timedOut; }
    }
}
