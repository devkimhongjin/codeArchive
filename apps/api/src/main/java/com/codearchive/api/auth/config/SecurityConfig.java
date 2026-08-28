package com.codearchive.api.auth.config;

import java.util.List;

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
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import com.codearchive.api.auth.AuthService;
import com.codearchive.api.auth.security.BearerTokenAuthenticationFilter;
import com.codearchive.api.auth.security.JsonAuthenticationEntryPoint;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private static final String BETA_EXTENSION_ORIGIN =
            "chrome-extension://oohlcmihldmfninmdcmanddfmhoonmdl";

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            AuthService authService,
            CorsConfigurationSource corsConfigurationSource
    ) throws Exception {
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
                                .requestMatchers(
                                        "/api/v1/status",
                                        "/api/v1/auth/github/login",
                                        "/api/v1/auth/github/extension-login",
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
                        new BearerTokenAuthenticationFilter(
                                authService
                        ),
                        UsernamePasswordAuthenticationFilter.class
                );

        return http.build();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration =
                new CorsConfiguration();
        configuration.setAllowedOrigins(
                List.of(BETA_EXTENSION_ORIGIN)
        );
        configuration.setAllowedMethods(
                List.of("GET", "POST", "OPTIONS")
        );
        configuration.setAllowedHeaders(
                List.of("Authorization", "Content-Type")
        );
        configuration.setAllowCredentials(false);

        UrlBasedCorsConfigurationSource source =
                new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
