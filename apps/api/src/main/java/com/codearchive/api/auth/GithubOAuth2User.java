package com.codearchive.api.auth;

import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.core.user.OAuth2User;

/** OAuth2 principal whose name is always the immutable GitHub numeric id. */
public final class GithubOAuth2User implements OAuth2User {

    private final Collection<? extends GrantedAuthority> authorities;
    private final Map<String, Object> attributes;
    private final GithubIdentity identity;

    public GithubOAuth2User(Collection<? extends GrantedAuthority> authorities,
                            Map<String, Object> attributes,
                            GithubIdentity identity) {
        this.authorities = authorities;
        this.attributes = Collections.unmodifiableMap(new HashMap<>(attributes));
        this.identity = identity;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return authorities;
    }

    @Override
    public Map<String, Object> getAttributes() {
        return attributes;
    }

    @Override
    public String getName() {
        return identity.githubId();
    }

    public GithubIdentity getIdentity() {
        return identity;
    }
}
