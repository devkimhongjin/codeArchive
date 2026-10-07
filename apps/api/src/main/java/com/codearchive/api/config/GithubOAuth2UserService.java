package com.codearchive.api.config;

import com.codearchive.api.auth.GithubIdentity;
import com.codearchive.api.auth.GithubOAuth2User;
import java.util.List;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.userinfo.DefaultOAuth2UserService;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserRequest;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserService;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.stereotype.Service;

@Service
public class GithubOAuth2UserService implements OAuth2UserService<OAuth2UserRequest, OAuth2User> {

    private final DefaultOAuth2UserService delegate = new DefaultOAuth2UserService();

    @Override
    public OAuth2User loadUser(OAuth2UserRequest userRequest) throws OAuth2AuthenticationException {
        if (!"github".equalsIgnoreCase(userRequest.getClientRegistration().getRegistrationId())) {
            throw new OAuth2AuthenticationException(new OAuth2Error("unsupported_provider"),
                    "Unsupported OAuth provider");
        }
        OAuth2User user = delegate.loadUser(userRequest);
        GithubIdentity identity = GithubIdentity.from(user)
                .orElseThrow(() -> new OAuth2AuthenticationException(new OAuth2Error("invalid_user_info_response"),
                        "GitHub identity is incomplete"));
        return new GithubOAuth2User(
                List.of(new SimpleGrantedAuthority("ROLE_USER")),
                user.getAttributes(),
                identity);
    }
}
