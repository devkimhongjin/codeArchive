package com.codearchive.api.relay;
import java.time.Instant; import java.util.*; import org.springframework.data.jpa.repository.JpaRepository; import org.springframework.data.jpa.repository.Modifying; import org.springframework.data.jpa.repository.Query;
public interface RelayGrantRepository extends JpaRepository<RelayGrant,Long> {
 Optional<RelayGrant> findByTokenHash(String tokenHash); List<RelayGrant> findByUserIdAndDeviceIdAndRevokedAtIsNull(Long userId,String deviceId); List<RelayGrant> findByUserIdAndRevokedAtIsNull(Long userId);
 @Modifying(flushAutomatically=true,clearAutomatically=true) @Query("update RelayGrant grant set grant.revokedAt=?2 where grant.user.id=?1 and grant.revokedAt is null") int revokeActiveForUser(Long userId,Instant revokedAt);
 @Modifying(flushAutomatically=true,clearAutomatically=true) @Query("update RelayGrant grant set grant.revokedAt=?3 where grant.user.id=?1 and grant.deviceId=?2 and grant.revokedAt is null") int revokeActiveForUserDevice(Long userId,String deviceId,Instant revokedAt);
}
