package com.codearchive.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;
import com.codearchive.api.automation.GithubAutomationProperties;

@SpringBootApplication
@EnableScheduling
@EnableConfigurationProperties(GithubAutomationProperties.class)
public class CodeArchiveApplication {

    public static void main(String[] args) {
        SpringApplication.run(CodeArchiveApplication.class, args);
    }
}
