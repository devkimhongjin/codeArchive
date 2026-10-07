package com.codearchive.api.auth;

import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DesktopLoginService {
    public static final String SESSION_KEY = "CODEARCHIVE_DESKTOP_LOGIN";
    public static final String CONSENT_KEY = "CODEARCHIVE_DESKTOP_LOGIN_CONSENT";
    public static final String COMPLETED_KEY = "CODEARCHIVE_DESKTOP_LOGIN_COMPLETED";
    public static final String INSTALL_KEY = "CODEARCHIVE_DESKTOP_INSTALL";
    public static final String CALLBACK_KEY = "CODEARCHIVE_DESKTOP_CALLBACK";
    public static final String FAILED_KEY = "CODEARCHIVE_DESKTOP_FAILED_CALLBACK";
    public record CallbackIntent(String requestId, String id, String state, long expiresAt) implements java.io.Serializable {}
    public record CallbackResult(String requestId, String state, String code, long expiresAt) implements java.io.Serializable {}
    public record CallbackFailure(String state, long expiresAt) implements java.io.Serializable {}
    public record InstallIntent(String githubId, long expiresAt) implements java.io.Serializable {}
    private final DesktopLoginRepository requests;
    private final UserRepository users;
    private final EntityManager entities;
    private final boolean enabled;
    private final SecureRandom random = new SecureRandom();
    public DesktopLoginService(DesktopLoginRepository requests, UserRepository users, EntityManager entities,
            @Value("${codearchive.desktop-login.enabled:false}") boolean enabled) {
        this.requests = requests; this.users = users; this.entities = entities; this.enabled = enabled;
    }
    public record Started(String requestId, long expiresIn) {}
    public static class Failure extends RuntimeException {
        public final HttpStatus status;
        Failure(HttpStatus status) { super("PC app login request is unavailable"); this.status = status; }
    }
    public void available() { if (!enabled) throw new Failure(HttpStatus.SERVICE_UNAVAILABLE); }
    @Transactional
    public Started create(String challenge, String peer) {
        return create(challenge, peer, false);
    }
    @Transactional
    public Started createCallback(String challenge, String peer) {
        return create(challenge, peer, true);
    }
    private Started create(String challenge, String peer, boolean callback) {
        available();
        if (challenge == null || !challenge.matches("[A-Za-z0-9_-]{43}")) throw new Failure(HttpStatus.BAD_REQUEST);
        // A global cap and expiry prevent abandoned public requests accumulating in storage.
        if (entities.find(DesktopLoginLock.class, 1, LockModeType.PESSIMISTIC_WRITE) == null)
            throw new Failure(HttpStatus.SERVICE_UNAVAILABLE);
        Instant now = Instant.now(); requests.deleteExpired(now);
        String clientKey = hash(peer);
        // Use the peer resolved by the server; the global cap remains in force for all peers.
        if (requests.count() >= 500 || requests.countByClientKey(clientKey) >= 10) throw new Failure(HttpStatus.TOO_MANY_REQUESTS);
        byte[] bytes = new byte[32]; random.nextBytes(bytes);
        String id = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expiry = now.plusSeconds(300);
        var request = new DesktopLoginRequest(hash(id), challenge, clientKey, expiry);
        if (callback) request.requireCallback();
        requests.save(request);
        return new Started(id, 300000);
    }
    @Transactional
    public String bind(String rawId) {
        available();
        if (rawId == null || !rawId.matches("[A-Za-z0-9_-]{43}")) throw new Failure(HttpStatus.BAD_REQUEST);
        String id = hash(rawId);
        DesktopLoginRequest request = current(id);
        if (request.bound()) throw new Failure(HttpStatus.CONFLICT);
        request.bind(); return id;
    }
    @Transactional
    public void check(String id) { available(); current(id); }
    @Transactional
    public void cancel(String id) {
        if (id != null && id.matches("[a-f0-9]{64}")) requests.locked(id).ifPresent(requests::delete);
    }
    @Transactional
    public void approve(String id, String githubId) {
        available(); DesktopLoginRequest request = current(id);
        if (request.callbackRequired() || !request.bound() || request.githubId() != null || users.findByGithubId(githubId).isEmpty())
            throw new Failure(HttpStatus.CONFLICT);
        request.approve(githubId);
    }
    @Transactional
    public String approveCallback(String id, String githubId) {
        available(); DesktopLoginRequest request = current(id);
        if (!request.callbackRequired() || !request.bound() || request.githubId() != null || users.findByGithubId(githubId).isEmpty())
            throw new Failure(HttpStatus.CONFLICT);
        byte[] bytes = new byte[32]; random.nextBytes(bytes);
        String code = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        request.approve(githubId); request.callbackCodeHash(hash(code));
        return code;
    }
    @Transactional
    public AppUser exchange(String rawId, String verifier) {
        return exchange(rawId, verifier, null);
    }
    @Transactional
    public AppUser exchange(String rawId, String verifier, String code) {
        available();
        if (rawId == null || !rawId.matches("[A-Za-z0-9_-]{43}") || verifier == null || !verifier.matches("[A-Za-z0-9_-]{43,128}"))
            throw new Failure(HttpStatus.BAD_REQUEST);
        DesktopLoginRequest request = current(hash(rawId));
        String actual = Base64.getUrlEncoder().withoutPadding().encodeToString(digest(verifier));
        if (!MessageDigest.isEqual(actual.getBytes(StandardCharsets.US_ASCII), request.challenge().getBytes(StandardCharsets.US_ASCII)))
            throw new Failure(HttpStatus.UNAUTHORIZED);
        if (request.githubId() == null) return null;
        if (request.callbackRequired() && (code == null || !code.matches("[A-Za-z0-9_-]{43}")
                || request.callbackCodeHash() == null || !MessageDigest.isEqual(hash(code).getBytes(StandardCharsets.US_ASCII),
                        request.callbackCodeHash().getBytes(StandardCharsets.US_ASCII)))) throw new Failure(HttpStatus.UNAUTHORIZED);
        AppUser user = users.findByGithubId(request.githubId()).orElseThrow(() -> new Failure(HttpStatus.GONE));
        requests.delete(request); requests.flush();
        return user;
    }
    private DesktopLoginRequest current(String id) {
        if (id == null || !id.matches("[a-f0-9]{64}")) throw new Failure(HttpStatus.GONE);
        DesktopLoginRequest request = requests.locked(id).orElseThrow(() -> new Failure(HttpStatus.GONE));
        if (!Instant.now().isBefore(request.expiresAt())) throw new Failure(HttpStatus.GONE);
        return request;
    }
    private static byte[] digest(String value) {
        try { return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.US_ASCII)); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException("SHA-256 unavailable"); }
    }
    private static String hash(String value) { return HexFormat.of().formatHex(digest(value)); }
}
