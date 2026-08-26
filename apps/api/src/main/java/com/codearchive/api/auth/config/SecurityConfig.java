package com.codearchive.api.auth.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

import com.codearchive.api.auth.AuthService;
import com.codearchive.api.auth.security.BearerTokenAuthenticationFilter;
import com.codearchive.api.auth.security.JsonAuthenticationEntryPoint;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            AuthService authService
    ) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
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
}
