package com.codearchive.api.automation;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class GithubJobDispatcherConfiguration {

    @Bean
    @ConditionalOnProperty(name = "codearchive.github.dispatch-mode", havingValue = "polling", matchIfMissing = true)
    GithubJobDispatcher noopGithubJobDispatcher() {
        return GithubJobDispatcher.noop();
    }
}
