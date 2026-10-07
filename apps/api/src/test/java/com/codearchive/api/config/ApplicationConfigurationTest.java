package com.codearchive.api.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.env.PropertySource;
import org.springframework.core.env.PropertySourcesPropertyResolver;
import org.springframework.core.io.ClassPathResource;

class ApplicationConfigurationTest {
    @Test
    void acceptsTheExistingPkcs8PrivateKeyVariable() throws IOException {
        PropertySourcesPropertyResolver resolver = resolver(Map.of(
                "GITHUB_APP_PRIVATE_KEY_PKCS8", "legacy-pkcs8-key"));

        assertThat(resolver.getProperty("codearchive.github.app-private-key"))
                .isEqualTo("legacy-pkcs8-key");
    }

    @Test
    void canonicalPrivateKeyVariableTakesPrecedence() throws IOException {
        PropertySourcesPropertyResolver resolver = resolver(Map.of(
                "GITHUB_APP_PRIVATE_KEY", "canonical-key",
                "GITHUB_APP_PRIVATE_KEY_PKCS8", "legacy-pkcs8-key"));

        assertThat(resolver.getProperty("codearchive.github.app-private-key"))
                .isEqualTo("canonical-key");
    }

    private PropertySourcesPropertyResolver resolver(Map<String, String> environment) throws IOException {
        MutablePropertySources sources = new MutablePropertySources();
        sources.addFirst(new MapPropertySource("testEnvironment", new HashMap<String, Object>(environment)));
        for (PropertySource<?> source : new YamlPropertySourceLoader().load(
                "applicationConfig", new ClassPathResource("application.yml"))) {
            sources.addLast(source);
        }
        return new PropertySourcesPropertyResolver(sources);
    }
}
