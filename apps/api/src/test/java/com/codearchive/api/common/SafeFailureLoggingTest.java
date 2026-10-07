package com.codearchive.api.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.core.read.ListAppender;
import java.util.Properties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataIntegrityViolationException;

class SafeFailureLoggingTest {
    private static final String SECRET_SOURCE = "public class SecretSolution { /* must not be logged */ }";

    @AfterEach
    void clearMdc() {
        MDC.clear();
    }

    @Test
    void dataIntegrityFailureLogsOnlyCodeAndCorrelation() {
        Logger logger = (Logger) LoggerFactory.getLogger(GlobalExceptionHandler.class);
        ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        MDC.put(RequestCorrelationFilter.MDC_KEY, "render-request-123");
        try {
            DataIntegrityViolationException failure = new DataIntegrityViolationException(
                    "Failing row contains (" + SECRET_SOURCE + ")");
            ApiError response = new GlobalExceptionHandler().handleDataIntegrity(failure).getBody();

            assertNotNull(response);
            assertEquals("Request conflicts with existing data", response.getMessage());
            String logs = appender.list.toString();
            assertTrue(logs.contains("errorCode=DATABASE_CONSTRAINT"));
            assertTrue(logs.contains("requestId=render-request-123"));
            assertFalse(logs.contains(SECRET_SOURCE));
            assertFalse(logs.contains("Failing row"));
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }

    @Test
    void productionDisablesHibernateVendorExceptionLogger() {
        YamlPropertiesFactoryBean yaml = new YamlPropertiesFactoryBean();
        yaml.setResources(new ClassPathResource("application-prod.yml"));
        Properties properties = yaml.getObject();

        assertNotNull(properties);
        assertEquals("OFF", properties.getProperty(
                "logging.level.org.hibernate.engine.jdbc.spi.SqlExceptionHelper"));
    }
}
