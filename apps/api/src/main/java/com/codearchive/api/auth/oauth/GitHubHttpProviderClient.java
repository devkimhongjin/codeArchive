package com.codearchive.api.auth.oauth;

import java.util.Map;

import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

import com.codearchive.api.auth.config.AuthProperties;
import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

@Component
public class GitHubHttpProviderClient implements GitHubProviderClient {

    private static final ParameterizedTypeReference<Map<String, Object>>
            MAP_TYPE = new ParameterizedTypeReference<>() {
            };

    private final RestClient restClient;
    private final AuthProperties authProperties;

    public GitHubHttpProviderClient(
            RestClient.Builder restClientBuilder,
            AuthProperties authProperties
    ) {
        this.restClient = restClientBuilder.build();
        this.authProperties = authProperties;
    }

    @Override
    public GitHubUserProfile fetchUser(String authorizationCode) {
        AuthProperties.Github github = authProperties.getGithub();

        if (isBlank(github.getClientId())
                || isBlank(github.getClientSecret())
                || isBlank(github.getCallbackUrl())) {
            throw new CodeArchiveException(
                    ErrorCode.AUTH_PROVIDER_UNAVAILABLE
            );
        }

        try {
            String providerToken = exchangeCode(
                    authorizationCode,
                    github
            );
            return fetchProfile(providerToken, github);
        } catch (CodeArchiveException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new CodeArchiveException(
                    ErrorCode.EXTERNAL_API_ERROR
            );
        }
    }

    private String exchangeCode(
            String authorizationCode,
            AuthProperties.Github github
    ) {
        MultiValueMap<String, String> form =
                new LinkedMultiValueMap<>();
        form.add("client_id", github.getClientId());
        form.add("client_secret", github.getClientSecret());
        form.add("code", authorizationCode);
        form.add("redirect_uri", github.getCallbackUrl());

        Map<String, Object> response = restClient.post()
                .uri(github.getTokenUrl())
                .contentType(
                        MediaType.APPLICATION_FORM_URLENCODED
                )
                .accept(MediaType.APPLICATION_JSON)
                .body(form)
                .retrieve()
                .body(MAP_TYPE);

        String providerToken = stringValue(
                response,
                "access_token"
        );

        if (isBlank(providerToken)) {
            throw new CodeArchiveException(
                    ErrorCode.EXTERNAL_API_ERROR
            );
        }

        return providerToken;
    }

    private GitHubUserProfile fetchProfile(
            String providerToken,
            AuthProperties.Github github
    ) {
        Map<String, Object> response = restClient.get()
                .uri(github.getUserUrl())
                .header(
                        HttpHeaders.AUTHORIZATION,
                        "Bearer " + providerToken
                )
                .accept(MediaType.APPLICATION_JSON)
                .retrieve()
                .body(MAP_TYPE);

        if (response == null
                || !(response.get("id") instanceof Number id)) {
            throw new CodeArchiveException(
                    ErrorCode.EXTERNAL_API_ERROR
            );
        }

        String login = stringValue(response, "login");

        if (isBlank(login)) {
            throw new CodeArchiveException(
                    ErrorCode.EXTERNAL_API_ERROR
            );
        }

        return new GitHubUserProfile(
                id.longValue(),
                login,
                nullableString(response.get("name")),
                nullableString(response.get("avatar_url"))
        );
    }

    private String stringValue(
            Map<String, Object> response,
            String key
    ) {
        if (response == null) {
            return null;
        }
        return nullableString(response.get(key));
    }

    private String nullableString(Object value) {
        return value instanceof String text ? text : null;
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
