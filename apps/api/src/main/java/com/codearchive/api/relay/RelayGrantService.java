package com.codearchive.api.relay;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import com.codearchive.api.settings.UserSettingsRepository;

/** Transactional account-bound revocation boundary used by settings and logout. */
@Service
public class RelayGrantService {
 private final RelayGrantRepository grants;
 private final UserSettingsRepository settings;
 public RelayGrantService(RelayGrantRepository grants, UserSettingsRepository settings) { this.grants=grants; this.settings=settings; }
 @Transactional public int revokeActiveForUser(Long userId) { return grants.revokeActiveForUser(userId,Instant.now()); }
 @Transactional public int revokeActiveForUserDevice(Long userId,String deviceId) { return grants.revokeActiveForUserDevice(userId,deviceId,Instant.now()); }
 @Transactional public void revokeForLogout(Long userId) { grants.revokeActiveForUser(userId,Instant.now()); settings.findByUserId(userId).ifPresent(value -> { value.revokeAutomationConsent(); settings.saveAndFlush(value); }); }
}
