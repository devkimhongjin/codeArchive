package com.codearchive.api.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "codearchive.ai")
public class AiProperties {

    private int dailyRequestLimit = 20;

    public int getDailyRequestLimit() {
        return dailyRequestLimit;
    }

    public void setDailyRequestLimit(int dailyRequestLimit) {
        if (dailyRequestLimit < 1) {
            throw new IllegalArgumentException(
                    "AI daily request limit must be positive"
            );
        }
        this.dailyRequestLimit = dailyRequestLimit;
    }
}
