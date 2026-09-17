package com.codearchive.api.integration.github;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpSession;
import java.io.Serializable;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Creates a short-lived, signed GitHub App installation state and binds it to
 * the browser session that started the flow. The signed payload protects the
 * callback parameters while the session digest makes each state single-use.
 */
@Service
public class GithubInstallStateService {
    private static final String SESSION_ATTRIBUTE = GithubInstallStateService.class.getName() + ".pending";
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();
    private static final String RETURN_PATH = "/";

    private final String appSlug;
    private final byte[] signingKey;
    private final Duration ttl;
    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final SecureRandom random;

    @Autowired
    public GithubInstallStateService(
            @Value("${codearchive.github.app-slug:}") String appSlug,
            @Value("${codearchive.github.app-private-key:}") String privateKey,
            @Value("${codearchive.github.install-state-ttl-seconds:600}") long ttlSeconds,
            ObjectMapper objectMapper) {
        this(appSlug, privateKey, Duration.ofSeconds(Math.max(60, Math.min(1800, ttlSeconds))),
                objectMapper, Clock.systemUTC(), new SecureRandom());
    }

    GithubInstallStateService(String appSlug, String privateKey, Duration ttl, ObjectMapper objectMapper,
                              Clock clock, SecureRandom random) {
        this.appSlug = appSlug == null ? "" : appSlug.trim();
        this.signingKey = deriveKey(privateKey == null ? "" : privateKey);
        this.ttl = ttl;
        this.objectMapper = objectMapper;
        this.clock = clock;
        this.random = random;
    }

    public boolean ready() {
        return appSlug.matches("[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?") && signingKey.length > 0;
    }

    public String issue(long userId, String githubId, HttpSession session) {
        if (!ready() || userId <= 0 || !validGithubId(githubId)) {
            throw new InstallStateException(Failure.PROVIDER_UNAVAILABLE);
        }
        try {
            Instant now = clock.instant();
            byte[] nonceBytes = new byte[32];
            random.nextBytes(nonceBytes);
            Payload payload = new Payload(1, userId, githubId, now.getEpochSecond(), now.plus(ttl).getEpochSecond(),
                    ENCODER.encodeToString(nonceBytes), RETURN_PATH);
            String encodedPayload = ENCODER.encodeToString(objectMapper.writeValueAsBytes(payload));
            String state = encodedPayload + "." + ENCODER.encodeToString(sign(encodedPayload));
            session.setAttribute(SESSION_ATTRIBUTE,
                    new PendingState(sha256(state.getBytes(StandardCharsets.US_ASCII)), payload.expiresAt()));
            return "https://github.com/apps/" + appSlug + "/installations/new?state="
                    + URLEncoder.encode(state, StandardCharsets.UTF_8);
        } catch (InstallStateException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new InstallStateException(Failure.PROVIDER_UNAVAILABLE);
        }
    }

    public Payload consume(String state, long userId, String githubId, HttpSession session) {
        if (state == null || state.length() > 4096 || !state.matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+")) {
            throw new InstallStateException(Failure.INVALID);
        }
        Object pendingValue = session == null ? null : session.getAttribute(SESSION_ATTRIBUTE);
        if (!(pendingValue instanceof PendingState pending)) {
            throw new InstallStateException(Failure.REPLAYED);
        }
        String[] parts = state.split("\\.", -1);
        byte[] expectedSignature = sign(parts[0]);
        byte[] actualSignature;
        Payload payload;
        try {
            actualSignature = DECODER.decode(parts[1]);
            payload = objectMapper.readValue(DECODER.decode(parts[0]), Payload.class);
        } catch (Exception exception) {
            throw new InstallStateException(Failure.INVALID);
        }
        if (!MessageDigest.isEqual(expectedSignature, actualSignature)
                || !MessageDigest.isEqual(pending.digest(), sha256(state.getBytes(StandardCharsets.US_ASCII)))) {
            throw new InstallStateException(Failure.INVALID);
        }

        // A state that matches this session is consumed before any external
        // provider call, so refreshes and callback retries cannot replay it.
        session.removeAttribute(SESSION_ATTRIBUTE);
        long now = clock.instant().getEpochSecond();
        if (payload.version() != 1 || payload.expiresAt() != pending.expiresAt()
                || payload.issuedAt() > now + 30 || payload.expiresAt() < now
                || payload.expiresAt() - payload.issuedAt() > ttl.toSeconds()
                || !RETURN_PATH.equals(payload.returnPath()) || payload.nonce() == null
                || !payload.nonce().matches("[A-Za-z0-9_-]{40,64}")) {
            throw new InstallStateException(payload.expiresAt() < now ? Failure.EXPIRED : Failure.INVALID);
        }
        if (payload.userId() != userId || !constantTimeEquals(payload.githubId(), githubId)) {
            throw new InstallStateException(Failure.ACCOUNT_MISMATCH);
        }
        return payload;
    }

    private byte[] sign(String encodedPayload) {
        if (signingKey.length == 0) {
            throw new InstallStateException(Failure.PROVIDER_UNAVAILABLE);
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(signingKey, "HmacSHA256"));
            return mac.doFinal(encodedPayload.getBytes(StandardCharsets.US_ASCII));
        } catch (Exception exception) {
            throw new InstallStateException(Failure.PROVIDER_UNAVAILABLE);
        }
    }

    private static byte[] deriveKey(String privateKey) {
        if (privateKey.isBlank()) return new byte[0];
        return sha256(("codearchive-github-install-state-v1\u0000" + privateKey)
                .getBytes(StandardCharsets.UTF_8));
    }

    private static byte[] sha256(byte[] value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value);
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private static boolean validGithubId(String value) {
        return value != null && value.matches("[1-9][0-9]{0,19}");
    }

    private static boolean constantTimeEquals(String left, String right) {
        if (left == null || right == null) return false;
        return MessageDigest.isEqual(left.getBytes(StandardCharsets.US_ASCII),
                right.getBytes(StandardCharsets.US_ASCII));
    }

    public record Payload(int version, long userId, String githubId, long issuedAt, long expiresAt,
                          String nonce, String returnPath) {}

    private record PendingState(byte[] digest, long expiresAt) implements Serializable {
        private static final long serialVersionUID = 1L;
    }

    public enum Failure { INVALID, EXPIRED, REPLAYED, ACCOUNT_MISMATCH, PROVIDER_UNAVAILABLE }

    public static final class InstallStateException extends RuntimeException {
        private final Failure failure;
        public InstallStateException(Failure failure) { super(failure.name()); this.failure = failure; }
        public Failure failure() { return failure; }
    }
}
