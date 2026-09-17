package com.codearchive.api.config;

import java.util.Collections;
import java.util.Iterator;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;

@Configuration
@EnableConfigurationProperties(GithubOAuth2Properties.class)
public class GithubOAuth2ClientConfiguration {

    @Bean
    ClientRegistrationRepository clientRegistrationRepository(GithubOAuth2Properties properties) {
        if (!properties.isEnabled()) {
            return new EmptyClientRegistrationRepository();
        }
        ClientRegistration github = ClientRegistration.withRegistrationId("github")
                .clientId(properties.getClientId())
                .clientSecret(properties.getClientSecret())
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .scope("read:user")
                .authorizationUri("https://github.com/login/oauth/authorize")
                .tokenUri("https://github.com/login/oauth/access_token")
                .userInfoUri("https://api.github.com/user")
                .userNameAttributeName("id")
                .clientName("GitHub")
                .redirectUri(properties.validatedRedirectUri())
                .build();
        return new InMemoryClientRegistrationRepository(github);
    }

    /** Keeps the OAuth filter chain available while disabled without fake credentials. */
    private static final class EmptyClientRegistrationRepository implements ClientRegistrationRepository,
            Iterable<ClientRegistration> {
        @Override
        public ClientRegistration findByRegistrationId(String registrationId) {
            return null;
        }

        @Override
        public Iterator<ClientRegistration> iterator() {
            return Collections.emptyIterator();
        }
    }
}
