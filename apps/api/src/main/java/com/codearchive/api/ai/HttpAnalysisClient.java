package com.codearchive.api.ai;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

@Component
public class HttpAnalysisClient implements AnalysisClient {

    private final RestClient restClient;
    private final AnalysisClientProperties properties;

    public HttpAnalysisClient(
            RestClient.Builder builder,
            AnalysisClientProperties properties
    ) {
        this.properties = properties;

        long configuredMillis = properties
                .getRequestTimeout()
                .toMillis();
        int timeoutMillis = (int) Math.min(
                configuredMillis,
                Integer.MAX_VALUE
        );

        SimpleClientHttpRequestFactory requestFactory =
                new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(timeoutMillis);
        requestFactory.setReadTimeout(timeoutMillis);

        this.restClient = builder
                .baseUrl(properties.getBaseUrl())
                .requestFactory(requestFactory)
                .build();
    }

    @Override
    public AnalysisResult analyze(AnalysisRequest request) {
        String internalToken = properties.getInternalToken();
        if (!StringUtils.hasText(internalToken)) {
            throw providerUnavailable();
        }

        try {
            AnalysisResponse response = restClient
                    .post()
                    .uri("/internal/v1/analysis")
                    .header(
                            HttpHeaders.AUTHORIZATION,
                            "Bearer " + internalToken
                    )
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(request)
                    .retrieve()
                    .body(AnalysisResponse.class);

            if (response == null
                    || !StringUtils.hasText(response.content())
                    || !StringUtils.hasText(response.provider())
                    || !StringUtils.hasText(response.model())) {
                throw new CodeArchiveException(
                        ErrorCode.AI_RESPONSE_INVALID
                );
            }

            return new AnalysisResult(
                    response.content(),
                    response.provider(),
                    response.model()
            );
        } catch (CodeArchiveException exception) {
            throw exception;
        } catch (RestClientException exception) {
            throw providerUnavailable();
        }
    }

    private CodeArchiveException providerUnavailable() {
        return new CodeArchiveException(
                ErrorCode.EXTERNAL_API_ERROR
        );
    }

    private record AnalysisResponse(
            String content,
            String provider,
            String model
    ) {
    }
}
