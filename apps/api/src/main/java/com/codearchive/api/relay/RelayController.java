package com.codearchive.api.relay;
import com.codearchive.api.auth.*; import com.codearchive.api.common.ApiError; import com.codearchive.api.common.GithubAccountAssertion; import com.codearchive.api.solution.*; import com.codearchive.api.automation.GithubAutomationService; import com.codearchive.api.settings.*;
import java.nio.charset.StandardCharsets; import java.security.*; import java.time.*; import java.util.*;
import org.springframework.http.ResponseEntity; import org.springframework.security.core.Authentication; import org.springframework.transaction.annotation.Transactional; import org.springframework.web.bind.annotation.*;
/** Isolated bearer-only append endpoint; it never accepts a payload account identity. */
@RestController @RequestMapping("/api/relay") public class RelayController {
 private final UserRepository users; private final RelayGrantRepository grants; private final RelayGrantService grantService; private final SolutionService solutions; private final GithubAutomationService automation; private final UserSettingsRepository settings;
 public RelayController(UserRepository users,RelayGrantRepository grants,RelayGrantService grantService,SolutionService solutions,GithubAutomationService automation,UserSettingsRepository settings){this.users=users;this.grants=grants;this.grantService=grantService;this.solutions=solutions;this.automation=automation;this.settings=settings;}
 @PostMapping("/grants") @Transactional public ResponseEntity<?> issue(Authentication auth,@RequestHeader(value=GithubAccountAssertion.HEADER,required=false) String expectedGithubId,@RequestBody GrantRequest request){
   var checked=GithubAccountAssertion.require(auth,expectedGithubId,users); if(!checked.accepted())return checked.failure(); AppUser user=checked.account().user();
   if(request==null||request.deviceId()==null||!request.deviceId().matches("[A-Za-z0-9_-]{16,100}"))return ResponseEntity.badRequest().body(new ApiError("Invalid device identity"));
   UserSettings current=settings.findByUserId(user.getId()).orElse(null); if(current==null||current.getVersion()!=request.generation()||!current.isAutoSyncEnabled())return ResponseEntity.status(409).body(new ApiError("Relay generation is stale or automatic sync is off"));
   grantService.revokeActiveForUserDevice(user.getId(),request.deviceId());
   String secret=randomSecret(); RelayGrant grant=new RelayGrant(user,hash(secret),request.deviceId(),request.generation(),Instant.now().plus(Duration.ofDays(30))); grants.save(grant);
   return ResponseEntity.ok(new GrantResponse(secret,request.generation(),"/api/relay/captures",Instant.now().plus(Duration.ofDays(30)).toString()));
 }
 @DeleteMapping("/grants/{deviceId}") @Transactional public ResponseEntity<?> revoke(Authentication auth,@RequestHeader(value=GithubAccountAssertion.HEADER,required=false) String expectedGithubId,@PathVariable String deviceId){
   var checked=GithubAccountAssertion.require(auth,expectedGithubId,users); if(!checked.accepted())return checked.failure(); AppUser user=checked.account().user();
   if(!deviceId.matches("[A-Za-z0-9_-]{16,100}"))return ResponseEntity.badRequest().body(new ApiError("Invalid device identity"));
   // The user predicate is deliberately in the query: another account cannot
   // infer or invalidate a device grant, and repeated DELETE is idempotent.
   grantService.revokeActiveForUserDevice(user.getId(),deviceId);
   return ResponseEntity.noContent().build();
 }
 @DeleteMapping("/grants/self") @Transactional public ResponseEntity<?> revokeSelf(@RequestHeader(value="Authorization",required=false) String authorization){
   if(authorization==null||!authorization.startsWith("Bearer "))return ResponseEntity.status(401).body(new ApiError("Relay authorization is required"));
   RelayGrant grant=grants.findByTokenHash(hash(authorization.substring(7))).orElse(null);
   if(grant==null)return ResponseEntity.status(401).body(new ApiError("Relay authorization is invalid"));
   // This bearer can only invalidate itself. It cannot read or mutate account settings.
   grant.revoke(); grants.saveAndFlush(grant); return ResponseEntity.noContent().build();
 }
 @PostMapping("/captures") @Transactional public ResponseEntity<?> append(@RequestHeader(value="Authorization",required=false) String authorization,@RequestBody CapturePayload capture){
   if(authorization==null||!authorization.startsWith("Bearer ")) return ResponseEntity.status(401).body(new ApiError("Relay authorization is required"));
   RelayGrant grant=grants.findByTokenHash(hash(authorization.substring(7))).filter(RelayGrant::usable).orElse(null); if(grant==null)return ResponseEntity.status(401).body(new ApiError("Relay authorization is invalid"));
   UserSettings current=settings.findByUserId(grant.getUser().getId()).orElse(null); if(current==null||!current.isAutoSyncEnabled()||current.getVersion()!=grant.getGeneration())return ResponseEntity.status(401).body(new ApiError("Relay authorization is stale"));
   try { Solution saved=solutions.upsert(grant.getUser().getGithubId(),capture); automation.consider(grant.getUser(), saved); return ResponseEntity.ok(Map.of("captureId",saved.getCaptureId(),"accepted",true,"generation",grant.getGeneration())); }
   catch(CaptureValidationException e){return ResponseEntity.badRequest().body(new ApiError(e.getMessage()));}
 }
 public record GrantRequest(String deviceId,long generation){} public record GrantResponse(String secret,long generation,String endpoint,String expiresAt){}
 private static String randomSecret(){byte[] b=new byte[32];new SecureRandom().nextBytes(b);return Base64.getUrlEncoder().withoutPadding().encodeToString(b);} private static String hash(String text){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));}catch(NoSuchAlgorithmException e){throw new IllegalStateException(e);}}
}
