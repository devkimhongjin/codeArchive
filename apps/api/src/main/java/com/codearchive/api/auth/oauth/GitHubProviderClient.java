package com.codearchive.api.auth.oauth;

public interface GitHubProviderClient {

    GitHubUserProfile fetchUser(String authorizationCode);
}
