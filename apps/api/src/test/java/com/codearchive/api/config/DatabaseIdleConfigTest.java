package com.codearchive.api.config;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.zaxxer.hikari.HikariConfig;
import java.util.List;
import java.util.Properties;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.bind.PropertySourcesPlaceholdersResolver;
import org.springframework.boot.context.properties.source.ConfigurationPropertySources;
import org.springframework.core.env.PropertiesPropertySource;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;

/** Neon scales to zero only after 5 minutes without a query; nothing idle may keep it awake. */
class DatabaseIdleConfigTest {
    @Test
    void productionPoolHoldsNoIdleConnectionAndNeverPingsTheDatabase() {
        PropertiesPropertySource prod = new PropertiesPropertySource("prod", yaml("application-prod.yml"));
        Binder binder = new Binder(ConfigurationPropertySources.from(prod),
                new PropertySourcesPlaceholdersResolver(List.<PropertySource<?>>of(prod)));

        HikariConfig hikari = binder.bind("spring.datasource.hikari", Bindable.ofInstance(new HikariConfig())).get();

        assertEquals(5, hikari.getMaximumPoolSize());
        assertEquals(0, hikari.getMinimumIdle());
        assertEquals(60_000, hikari.getIdleTimeout());
        assertEquals(0, hikari.getKeepaliveTime());
    }

    @Test
    void expiredSessionsAreCleanedOnceADay() {
        assertEquals("0 0 19 * * *", yaml("application.yml").getProperty("spring.session.jdbc.cleanup-cron"));
    }

    private static Properties yaml(String name) {
        YamlPropertiesFactoryBean yaml = new YamlPropertiesFactoryBean();
        yaml.setResources(new ClassPathResource(name));
        return yaml.getObject();
    }
}
