package com.codearchive.api.ai;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "codearchive.analysis")
public class AnalysisClientProperties {

    private String baseUrl = "http://localhost:8000";
    private String internalToken = "";
    private Duration requestTimeout = Duration.ofSeconds(15);

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public String getInternalToken() {
        return internalToken;
    }

    public void setInternalToken(String internalToken) {
        this.internalToken = internalToken;
    }

    public Duration getRequestTimeout() {
        return requestTimeout;
    }

    public void setRequestTimeout(Duration requestTimeout) {
        if (requestTimeout == null
                || requestTimeout.isZero()
                || requestTimeout.isNegative()) {
            throw new IllegalArgumentException(
                    "Analysis request timeout must be positive"
            );
        }
        this.requestTimeout = requestTimeout;
    }
}
