package com.codearchive.api.auth;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
public interface DesktopLoginRepository extends JpaRepository<DesktopLoginRequest, String> {
    long countByClientKey(String clientKey);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from DesktopLoginRequest r where r.id = :id")
    Optional<DesktopLoginRequest> locked(String id);
    @Modifying @Query("delete from DesktopLoginRequest r where r.expiresAt <= :now")
    void deleteExpired(Instant now);
}
