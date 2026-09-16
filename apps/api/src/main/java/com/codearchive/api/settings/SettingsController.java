package com.codearchive.api.settings;
import com.codearchive.api.auth.AppUser;
import com.codearchive.api.auth.GithubAuthentication;
import com.codearchive.api.auth.UserRepository;
import com.codearchive.api.common.ApiError;
import com.codearchive.api.relay.RelayGrantService;
import jakarta.persistence.OptimisticLockException;
import java.util.Set;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.core.Authentication;
import org.springframework.beans.factory.annotation.Value;

@RestController @RequestMapping("/api/settings")
public class SettingsController {
  private static final Set<String> LIGHT = Set.of("github-light", "vitesse-light", "catppuccin-latte", "solarized-light", "one-light");
  private static final Set<String> DARK = Set.of("github-dark", "vitesse-dark", "catppuccin-mocha", "dracula", "one-dark-pro");
  private final UserRepository users; private final UserSettingsRepository settings; private final RelayGrantService grants; private final String appId, privateKey, appSlug;
  public SettingsController(UserRepository users, UserSettingsRepository settings, RelayGrantService grants, @Value("${codearchive.github.app-id:}") String appId, @Value("${codearchive.github.app-private-key:}") String privateKey, @Value("${codearchive.github.app-slug:}") String appSlug) { this.users = users; this.settings = settings; this.grants = grants; this.appId=appId; this.privateKey=privateKey; this.appSlug=appSlug; }
  @GetMapping @Transactional public ResponseEntity<?> get(Authentication auth) { UserSettings s = forAuth(auth); return s == null ? unauthorized() : ResponseEntity.ok(response(s)); }
  @PutMapping @Transactional public ResponseEntity<?> put(Authentication auth, @RequestBody SettingsRequest request) {
    UserSettings s = forAuth(auth); if (s == null) return unauthorized();
    String problem = validate(request); if (problem != null) return ResponseEntity.badRequest().body(new ApiError(problem));
    if (request.version() != s.getVersion()) return ResponseEntity.status(409).body(new ApiError("Settings changed; refresh and retry"));
    // Organization installation selection needs an App-install callback and
    // is intentionally not inferred from a user-provided numeric ID. Until
    // that flow exists, only repositories owned by this GitHub identity are
    // eligible for automatic writes.
    if (requestedTarget(request) && (s.getUser().getGithubLogin()==null || !s.getUser().getGithubLogin().equalsIgnoreCase(request.githubOwner()))) return ResponseEntity.badRequest().body(new ApiError("GitHub automatic commits currently support personal-owner repositories only"));
    // A complete target plus automatic commits is a request for server-side
    // authority. Do not accept it unless this deployment has App credentials.
    if (request.githubAutoCommitEnabled() && requestedTarget(request) && !providerReady()) return ResponseEntity.badRequest().body(new ApiError("GitHub App provider is unavailable"));
    s.apply(request); settings.saveAndFlush(s);
    // Settings versions fence relay credentials. Dashboard obtains a fresh
    // account/generation-bound grant after each successful save.
    grants.revokeActiveForUser(s.getUser().getId());
    return ResponseEntity.ok(response(s));
  }
  private UserSettings forAuth(Authentication auth) { return GithubAuthentication.identity(auth).flatMap(i -> users.findByGithubId(i.githubId())).map(this::findOrCreate).orElse(null); }
  private UserSettings findOrCreate(AppUser user) { return settings.findByUserId(user.getId()).orElseGet(() -> settings.save(new UserSettings(user))); }
  private static ResponseEntity<ApiError> unauthorized() { return ResponseEntity.status(401).body(new ApiError("Authentication is required")); }
  private SettingsResponse response(UserSettings s) { return SettingsResponse.from(s,providerReady(),appSlug); }
  private boolean providerReady() { return !appId.isBlank() && !privateKey.isBlank(); }
  private static boolean requestedTarget(SettingsRequest r) { return r.githubInstallationId()!=null && r.githubOwner()!=null && !r.githubOwner().isBlank() && r.githubRepository()!=null && !r.githubRepository().isBlank() && r.githubBranch()!=null && !r.githubBranch().isBlank(); }
  private static String validate(SettingsRequest r) {
    if (r == null || overOptional(r.name(),255) || overOptional(r.nickname(),80) || requiredOver(r.downloadFilenameTemplate(),160) || requiredOver(r.gitPathTemplate(),240)) return "Invalid settings";
    if (!LIGHT.contains(r.lightTheme()) || !DARK.contains(r.darkTheme())) return "Unsupported Shiki theme";
    if (r.downloadFilenameTemplate().contains("/") || r.downloadFilenameTemplate().contains("\\") || control(r.downloadFilenameTemplate()) || reserved(r.downloadFilenameTemplate())) return "Download filename is unsafe";
    String path = r.gitPathTemplate(); if (!safeRelative(path,240)) return "Git path must stay beneath the configured root";
    if (r.githubInstallationId()!=null && r.githubInstallationId()<=0) return "GitHub installation ID must be positive";
    if (overOptional(r.githubOwner(),100) || overOptional(r.githubRepository(),100) || overOptional(r.githubBranch(),255) || !safeOptionalRoot(r.githubRootPath())) return "GitHub target is invalid";
    return null;
  }
  private static boolean overOptional(String s,int n){return s != null && s.length()>n;} private static boolean requiredOver(String s,int n){return s == null || s.isBlank() || s.length()>n;} private static boolean control(String s){return s.chars().anyMatch(c -> c < 32 || c == 127);}
  private static boolean safeOptionalRoot(String root){return root==null || safeRelative(root,240);}
  private static boolean safeRelative(String path,int max){if(path==null||path.isBlank()||path.length()>max||path.startsWith("/")||path.startsWith("\\")||path.matches("^[A-Za-z]:.*")||path.contains("\\")||path.contains("..")||control(path))return false;for(String segment:path.split("/")){if(segment.isBlank()||reserved(segment))return false;}return true;}
  private static boolean reserved(String value){String base=value.replaceAll("\\.[^.]*$","");return base.matches("(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])$");}
}
