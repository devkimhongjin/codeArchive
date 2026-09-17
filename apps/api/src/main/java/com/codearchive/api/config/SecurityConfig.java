package com.codearchive.api.config;

import jakarta.servlet.http.HttpServletResponse;
import java.io.Serializable;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestRedirectFilter;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.session.web.http.DefaultCookieSerializer;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.core.convert.converter.Converter;
import org.springframework.core.convert.support.GenericConversionService;
import org.springframework.core.serializer.support.DeserializingConverter;
import org.springframework.core.serializer.support.SerializingConverter;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.OAuth2User;
import com.codearchive.api.auth.GithubAuthentication;
import com.codearchive.api.auth.GithubOAuth2User;
import com.codearchive.api.auth.UserRepository;
import com.codearchive.api.automation.GithubAutomationProperties;
import com.codearchive.api.common.GithubAccountAssertion;
import com.codearchive.api.relay.RelayGrantService;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    /** Derived from the pinned public key in apps/extension/manifest.json. */
    private static final String EXTENSION_ORIGIN = "chrome-extension://oohlcmihldmfninmdcmanddfmhoonmdl";

    /**
     * JDBC sessions must serialize the GitHub principal across restarts. The OAuth2
     * principal intentionally is not Java-serializable, so persist a narrow, immutable
     * representation rather than making provider objects session storage contracts.
     */
    @Bean("springSessionConversionService")
    GenericConversionService springSessionConversionService() {
        GenericConversionService conversionService = new GenericConversionService();
        conversionService.addConverter(new SessionValueToBytes());
        conversionService.addConverter(new BytesToSessionValue());
        return conversionService;
    }

    @Bean
    CookieSerializer cookieSerializer(@org.springframework.beans.factory.annotation.Value("${server.servlet.session.cookie.secure:false}") boolean secure) {
        DefaultCookieSerializer serializer = new DefaultCookieSerializer();
        serializer.setCookieName("JSESSIONID");
        serializer.setUseHttpOnlyCookie(true);
        serializer.setUseSecureCookie(secure);
        serializer.setSameSite("Lax");
        return serializer;
    }

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            GithubOAuth2UserService githubOAuth2UserService,
            GithubOAuth2SuccessHandler githubOAuth2SuccessHandler,
            GithubOAuth2FailureHandler githubOAuth2FailureHandler,
            GithubOAuth2Properties githubProperties,
            GithubAutomationProperties automationProperties,
            UserRepository users,
            RelayGrantService relayGrants,
            AuthenticationEntryPoint authenticationEntryPoint,
            AccessDeniedHandler accessDeniedHandler) throws Exception {
        CookieCsrfTokenRepository csrfTokenRepository = CookieCsrfTokenRepository.withHttpOnlyFalse();
        CsrfTokenRequestAttributeHandler csrfRequestHandler = new CsrfTokenRequestAttributeHandler();

        http
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .csrf(csrf -> csrf
                        .csrfTokenRepository(csrfTokenRepository)
                        .csrfTokenRequestHandler(csrfRequestHandler)
                        // Relay is bearer-authenticated and deliberately has no browser session.
                        .ignoringRequestMatchers("/api/relay/captures", "/api/relay/grants/self"));
        if (automationProperties.getWorker().isHttpEnabled()) {
            // The condition also controls controller registration. This private Cloud Run
            // worker is authenticated by IAM/OIDC rather than browser cookies or CSRF.
            http.csrf(csrf -> csrf.ignoringRequestMatchers("/internal/github/**"));
        }

        http
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint(authenticationEntryPoint)
                        .accessDeniedHandler(accessDeniedHandler))
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED)
                        .sessionFixation(sessionFixation -> sessionFixation.migrateSession()))
                .authorizeHttpRequests(authorize -> {
                    // These routes exist only in a separately deployed private worker. Cloud Run IAM
                    // is their authentication boundary; never expose that worker unauthenticated.
                    if (automationProperties.getWorker().isHttpEnabled()) {
                        authorize.requestMatchers("/internal/github/**").permitAll();
                    }
                    authorize.requestMatchers(HttpMethod.GET, "/actuator/health").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/health", "/api/auth/csrf", "/api/auth/providers").permitAll()
                        // GitHub returns the browser here. The controller converts a
                        // missing/expired login session into a fixed dashboard result;
                        // state and installation ownership still require authentication.
                        .requestMatchers(HttpMethod.GET, "/api/github/installations/callback").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/register", "/api/auth/login").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/relay/captures").permitAll()
                        .requestMatchers(HttpMethod.DELETE, "/api/relay/grants/self").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/oauth2/authorization/github",
                                "/api/login/oauth2/code/github").permitAll()
                        .requestMatchers("/error").permitAll()
                        .anyRequest().authenticated();
                })
                .httpBasic(httpBasic -> httpBasic.disable())
                .formLogin(formLogin -> formLogin.disable())
                .oauth2Login(oauth2 -> oauth2
                        .authorizationEndpoint(endpoint -> endpoint.baseUri("/api/oauth2/authorization"))
                        .redirectionEndpoint(endpoint -> endpoint.baseUri("/api/login/oauth2/code/*"))
                        .userInfoEndpoint(endpoint -> endpoint.userService(githubOAuth2UserService))
                        .successHandler(githubOAuth2SuccessHandler)
                        .failureHandler(githubOAuth2FailureHandler))
                .logout(logout -> logout
                        .logoutUrl("/api/auth/logout")
                        .addLogoutHandler((request, response, authentication) -> revokeRelayGrants(request, authentication, users, relayGrants))
                        .invalidateHttpSession(true)
                        .clearAuthentication(true)
                        .deleteCookies("JSESSIONID")
                        .logoutSuccessHandler((request, response, authentication) -> {
                            // Session logout is an account boundary: invalidate all
                            // outstanding opaque relay grants before clearing it.
                            revokeRelayGrants(request, authentication, users, relayGrants);
                            response.setStatus(HttpServletResponse.SC_NO_CONTENT);
                        }))
                .addFilterBefore(new GithubOAuth2AvailabilityFilter(githubProperties),
                        OAuth2AuthorizationRequestRedirectFilter.class);

        return http.build();
    }

    @Bean
    AuthenticationEntryPoint authenticationEntryPoint() {
        return (request, response, exception) -> writeJsonError(response, HttpServletResponse.SC_UNAUTHORIZED,
                "Authentication is required");
    }

    @Bean
    AccessDeniedHandler accessDeniedHandler() {
        return (request, response, exception) -> writeJsonError(response, HttpServletResponse.SC_FORBIDDEN,
                "Request is not allowed");
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        String configuredOrigins = System.getProperty("codearchive.cors.allowed-origins",
                System.getenv().getOrDefault("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"));
        List<String> origins = Arrays.stream(configuredOrigins.split(","))
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .collect(Collectors.toList());
        configuration.setAllowedOrigins(origins);
        configuration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(Arrays.asList(
                "Content-Type", "X-XSRF-TOKEN", "X-CSRF-TOKEN", "X-CodeArchive-Account", GithubAccountAssertion.HEADER));
        configuration.setExposedHeaders(Arrays.asList("Set-Cookie"));
        configuration.setAllowCredentials(true);

        // The service worker sends only bearer-authenticated relay requests. Keep
        // its privileged Origin and Authorization header scoped to relay routes;
        // ordinary dashboard endpoints retain the narrower session/CSRF policy.
        CorsConfiguration relayConfiguration = new CorsConfiguration(configuration);
        List<String> relayOrigins = new ArrayList<>(origins);
        if (!relayOrigins.contains(EXTENSION_ORIGIN)) relayOrigins.add(EXTENSION_ORIGIN);
        relayConfiguration.setAllowedOrigins(relayOrigins);
        List<String> relayHeaders = new ArrayList<>(configuration.getAllowedHeaders());
        relayHeaders.add("Authorization");
        relayConfiguration.setAllowedHeaders(relayHeaders);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/relay/**", relayConfiguration);
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }

    private static void writeJsonError(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"message\":\"" + escapeJson(message) + "\"}");
    }

    private static String escapeJson(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static void revokeRelayGrants(jakarta.servlet.http.HttpServletRequest request, Authentication authentication,
            UserRepository users, RelayGrantService relayGrants) {
        Authentication subject = authentication;
        if (subject == null && request.getSession(false) != null) {
            Object saved = request.getSession(false)
                    .getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
            if (saved instanceof SecurityContext context) {
                subject = context.getAuthentication();
            }
        }
        GithubAuthentication.identity(subject).flatMap(i -> users.findByGithubId(i.githubId()))
                .ifPresent(account -> relayGrants.revokeForLogout(account.getId()));
    }

    private static final class SessionValueToBytes implements Converter<Object, byte[]> {
        private final SerializingConverter serializer = new SerializingConverter();

        @Override
        public byte[] convert(Object source) {
            Object durable = source;
            if (source instanceof SecurityContext context
                    && context.getAuthentication() instanceof OAuth2AuthenticationToken token
                    && token.getPrincipal() instanceof GithubOAuth2User user) {
                durable = StoredGithubSecurityContext.from(token, user);
            }
            return serializer.convert(durable);
        }
    }

    private static final class BytesToSessionValue implements Converter<byte[], Object> {
        private final DeserializingConverter deserializer = new DeserializingConverter();

        @Override
        public Object convert(byte[] source) {
            Object restored = deserializer.convert(source);
            return restored instanceof StoredGithubSecurityContext stored ? stored.toSecurityContext() : restored;
        }
    }

    private record StoredGithubSecurityContext(
            String githubId, String githubLogin, String githubName, String githubEmail,
            java.util.Map<String, Object> attributes,
            java.util.List<String> authorities, String registrationId) implements Serializable {

        private static StoredGithubSecurityContext from(OAuth2AuthenticationToken token, GithubOAuth2User user) {
            return new StoredGithubSecurityContext(user.getIdentity().githubId(), user.getIdentity().githubLogin(),
                    user.getIdentity().name(), user.getIdentity().email(), new java.util.HashMap<>(user.getAttributes()),
                    user.getAuthorities().stream().map(GrantedAuthority::getAuthority).toList(),
                    token.getAuthorizedClientRegistrationId());
        }

        private SecurityContext toSecurityContext() {
            java.util.List<GrantedAuthority> restoredAuthorities = new ArrayList<>();
            authorities.forEach(authority -> restoredAuthorities.add(new SimpleGrantedAuthority(authority)));
            OAuth2User user = new GithubOAuth2User(restoredAuthorities, attributes,
                    new com.codearchive.api.auth.GithubIdentity(githubId, githubLogin, githubName, githubEmail));
            SecurityContext context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(new OAuth2AuthenticationToken(user, restoredAuthorities, registrationId));
            return context;
        }
    }
}
