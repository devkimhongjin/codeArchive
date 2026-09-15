package com.codearchive.api.auth.config;

import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;

import com.codearchive.api.auth.AuthService;
import com.codearchive.api.auth.security.ApiAuthenticationFilter;
import com.codearchive.api.auth.security.JsonAuthenticationEntryPoint;
import com.codearchive.api.relay.RelayGrantAuthenticationFilter;
import com.codearchive.api.relay.RelayGrantService;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private static final String BETA_EXTENSION_ORIGIN =
            "chrome-extension://oohlcmihldmfninmdcmanddfmhoonmdl";

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            AuthService authService,
            ObjectProvider<RelayGrantService> relayGrantServices,
            CorsConfigurationSource corsConfigurationSource,
            @Value("${codearchive.auth.dashboard-origin:}")
            String configuredDashboardOrigin,
            @Value("${codearchive.auth.dashboard-allowed-origins:}")
            String configuredDashboardAllowedOrigins
    ) throws Exception {
        java.util.Set<String> dashboardOrigins = dashboardOrigins(
                configuredDashboardOrigin,
                configuredDashboardAllowedOrigins
        );

        http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(cors -> cors.configurationSource(
                        corsConfigurationSource
                ))
                .sessionManagement(session ->
                        session.sessionCreationPolicy(
                                SessionCreationPolicy.STATELESS
                        )
                )
                .authorizeHttpRequests(authorize ->
                        authorize
                                .requestMatchers(org.springframework.http.HttpMethod.POST,
                                        "/api/v1/internal/automation/invoke")
                                .permitAll()
                                .requestMatchers(
                                        "/api/v1/status",
                                        "/api/v1/auth/github/login",
                                        "/api/v1/auth/github/extension-login",
                                        "/api/v1/auth/github/dashboard-login",
                                        "/api/v1/auth/github/callback",
                                        "/api/v1/auth/exchange",
                                        "/actuator/health",
                                        "/actuator/info"
                                )
                                .permitAll()
                                .anyRequest()
                                .authenticated()
                )
                .exceptionHandling(exceptions ->
                        exceptions.authenticationEntryPoint(
                                new JsonAuthenticationEntryPoint()
                        )
                )
                .addFilterBefore(
                        new ApiAuthenticationFilter(
                                authService,
                                dashboardOrigins
                        ),
                        UsernamePasswordAuthenticationFilter.class
                );

        RelayGrantService relayGrantService = relayGrantServices.getIfAvailable();
        if (relayGrantService != null) {
            http.addFilterBefore(
                    new RelayGrantAuthenticationFilter(relayGrantService),
                    ApiAuthenticationFilter.class
            );
        }

        return http.build();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(
            @Value("${codearchive.auth.dashboard-origin:}")
            String configuredDashboardOrigin,
            @Value("${codearchive.auth.dashboard-allowed-origins:}")
            String configuredDashboardAllowedOrigins
    ) {
        CorsConfiguration extensionConfiguration =
                corsConfiguration(
                        java.util.Set.of(BETA_EXTENSION_ORIGIN),
                        false
                );

        java.util.Set<String> dashboardOrigins = dashboardOrigins(
                configuredDashboardOrigin,
                configuredDashboardAllowedOrigins
        );
        CorsConfiguration dashboardConfiguration =
                dashboardOrigins.isEmpty()
                        ? null
                        : corsConfiguration(
                                dashboardOrigins,
                                true
                        );

        return request -> {
            String origin = request.getHeader(
                    org.springframework.http.HttpHeaders.ORIGIN
            );
            if (dashboardConfiguration != null
                    && origin != null
                    && dashboardOrigins.contains(origin)) {
                return dashboardConfiguration;
            }
            return extensionConfiguration;
        };
    }

    private CorsConfiguration corsConfiguration(
            java.util.Set<String> allowedOrigins,
            boolean allowCredentials
    ) {
        CorsConfiguration configuration =
                new CorsConfiguration();
        configuration.setAllowedOrigins(
                List.copyOf(allowedOrigins)
        );
        configuration.setAllowedMethods(
                List.of("GET", "POST", "PUT", "DELETE", "OPTIONS")
        );
        configuration.setAllowedHeaders(
                List.of("Authorization", "Content-Type")
        );
        configuration.setAllowCredentials(allowCredentials);
        return configuration;
    }

    static java.util.Set<String> dashboardOrigins(
            String configuredDashboardOrigin,
            String configuredDashboardAllowedOrigins
    ) {
        java.util.Set<String> configured = DashboardOriginValidator
                .normalizeAllowed(configuredDashboardAllowedOrigins);
        if (configuredDashboardAllowedOrigins != null
                && !configuredDashboardAllowedOrigins.isBlank()) {
            return configured;
        }
        return DashboardOriginValidator
                .normalize(configuredDashboardOrigin)
                .map(java.util.Set::of)
                .orElseGet(java.util.Set::of);
    }
}
