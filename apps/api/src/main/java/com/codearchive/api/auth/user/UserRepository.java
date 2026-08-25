package com.codearchive.api.auth.user;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository
        extends JpaRepository<CodeArchiveUser, UUID> {

    Optional<CodeArchiveUser> findByGithubUserId(long githubUserId);
}
