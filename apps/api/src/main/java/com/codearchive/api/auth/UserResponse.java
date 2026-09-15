package com.codearchive.api.auth;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class UserResponse {
    private final Long id;
    private final String githubId;
    private final String githubLogin;
    private final String name;
    private final String email;

    private UserResponse(Long id, String githubId, String githubLogin, String name, String email) {
        this.id = id;
        this.githubId = githubId;
        this.githubLogin = githubLogin;
        this.name = name;
        this.email = email;
    }

    public static UserResponse from(AppUser user) {
        return new UserResponse(user.getId(), user.getGithubId(), user.getGithubLogin(), user.getGithubName(),
                user.getGithubEmail());
    }

    public Long getId() {
        return id;
    }

    public String getGithubId() {
        return githubId;
    }

    public String getGithubLogin() {
        return githubLogin;
    }

    public String getName() {
        return name;
    }

    public String getEmail() {
        return email;
    }
}
