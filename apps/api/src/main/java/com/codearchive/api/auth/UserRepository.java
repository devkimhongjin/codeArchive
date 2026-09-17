package com.codearchive.api.auth;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<AppUser, Long> {
    Optional<AppUser> findByEmail(String email);

    boolean existsByEmail(String email);

    Optional<AppUser> findByGithubId(String githubId);

    boolean existsByGithubId(String githubId);
}
