package com.codearchive.api.integration.github;

import com.codearchive.api.auth.*;import com.codearchive.api.automation.GithubAppProvider;import com.codearchive.api.common.ApiError;import com.codearchive.api.common.GithubAccountAssertion;import java.util.*;import org.springframework.http.*;import org.springframework.security.core.Authentication;import org.springframework.web.bind.annotation.*;
/** Authenticated target cascade; all repository IDs are resolved through the installation token. */
@RestController @RequestMapping("/api/github/targets") public class GithubTargetController{
 private final UserRepository users;private final GithubAppProvider github;public GithubTargetController(UserRepository users,GithubAppProvider github){this.users=users;this.github=github;}
 private ResponseEntity<?> call(Authentication a,String expected,Work w){var checked=GithubAccountAssertion.require(a,expected,users);if(!checked.accepted())return checked.failure();if(!github.browseReady())return ResponseEntity.status(503).build();try{return ResponseEntity.ok(w.run(checked.account().githubId()));}catch(GithubAppProvider.EmptyRepositoryConflictException e){return ResponseEntity.status(409).build();}catch(IllegalArgumentException e){return ResponseEntity.badRequest().build();}catch(SecurityException e){return ResponseEntity.status(403).build();}catch(Exception e){return ResponseEntity.status(503).build();}}
 @GetMapping("/installations") public ResponseEntity<?> installations(Authentication a,@RequestHeader(value=GithubAccountAssertion.HEADER,required=false) String expected){return call(a,expected,id->github.installations(id));}
 @GetMapping("/installations/{id}/repositories") public ResponseEntity<?> repositories(Authentication a,@RequestHeader(value=GithubAccountAssertion.HEADER,required=false) String expected,@PathVariable long id,@RequestParam(defaultValue="1") int page){return call(a,expected,githubId->github.repositoriesPage(githubId,id,page));}
 @GetMapping("/installations/{id}/repositories/{repo}/branches") public ResponseEntity<?> branches(Authentication a,@RequestHeader(value=GithubAccountAssertion.HEADER,required=false) String expected,@PathVariable long id,@PathVariable long repo,@RequestParam(defaultValue="1") int page){return call(a,expected,githubId->github.branchesPage(githubId,id,repo,page));}
 @GetMapping("/installations/{id}/repositories/{repo}/directories") public ResponseEntity<?> dirs(Authentication a,@RequestHeader(value=GithubAccountAssertion.HEADER,required=false) String expected,@PathVariable long id,@PathVariable long repo,@RequestParam String branch,@RequestParam(defaultValue="") String path){return call(a,expected,githubId->github.directories(githubId,id,repo,branch,path));}
 @GetMapping("/readme-preview") public ResponseEntity<?> readmePreview(Authentication a,@RequestHeader(value=GithubAccountAssertion.HEADER,required=false) String expected){return call(a,expected,id->Map.of("content",GithubAppProvider.INITIAL_README));}
 @GetMapping("/installations/{id}/repositories/{repo}/empty-default-branch") public ResponseEntity<?> emptyDefaultBranch(Authentication a,@RequestHeader(value=GithubAccountAssertion.HEADER,required=false) String expected,@PathVariable long id,@PathVariable long repo){return call(a,expected,githubId->Map.of("defaultBranch",github.emptyDefaultBranch(githubId,id,repo)));}
 @PostMapping("/installations/{id}/repositories/{repo}/initialize-readme") public ResponseEntity<?> initializeReadme(Authentication a,@RequestHeader(value=GithubAccountAssertion.HEADER,required=false) String expected,@PathVariable long id,@PathVariable long repo){
  var checked=GithubAccountAssertion.require(a,expected,users);
  if(!checked.accepted())return checked.failure();
  if(!github.browseReady())return ResponseEntity.status(503).body(new ApiError("GitHub App provider is unavailable"));
  try{return ResponseEntity.ok(Map.of("defaultBranch",github.initializeReadme(checked.account().githubId(),id,repo)));}
  catch(GithubAppProvider.EmptyRepositoryConflictException e){return ResponseEntity.status(409).body(new ApiError("Repository is already initialized; refresh branches"));}
  catch(IllegalArgumentException e){return ResponseEntity.badRequest().body(new ApiError("Invalid repository selection"));}
  catch(SecurityException e){return ResponseEntity.status(403).body(new ApiError("Repository is not available to this account"));}
  catch(Exception e){return ResponseEntity.status(503).body(new ApiError("Repository initialization could not be confirmed; refresh before retrying"));}
 }
 @FunctionalInterface interface Work{Object run(String login)throws Exception;}
}
