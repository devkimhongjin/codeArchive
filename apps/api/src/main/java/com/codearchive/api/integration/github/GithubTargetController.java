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
 @GetMapping("/installations/{id}/repositories/{repo}/tree") public ResponseEntity<?> tree(Authentication a,@RequestHeader(value=GithubAccountAssertion.HEADER,required=false) String expected,@PathVariable long id,@PathVariable long repo,@RequestParam String branch,@RequestParam(defaultValue="") String path,@RequestParam(defaultValue="1") int page){return call(a,expected,githubId->github.treePage(githubId,id,repo,branch,path,page));}
 public record AddFileRequest(String branch,String path,String content,String message,String expectedHeadSha,boolean placeholder){}
 public record TreeOperationPreviewRequest(String operation,String branch,String sourcePath,String destinationPath,String message,String expectedHeadSha){}
 public record TreeOperationCommitRequest(String previewId){}
 @PostMapping("/installations/{id}/repositories/{repo}/files") public ResponseEntity<?> addFile(Authentication a,@RequestHeader(value=GithubAccountAssertion.HEADER,required=false) String expected,@PathVariable long id,@PathVariable long repo,@RequestBody AddFileRequest request){
  var checked=GithubAccountAssertion.require(a,expected,users);
  if(!checked.accepted())return checked.failure();
  if(request==null)return ResponseEntity.badRequest().body(new ApiError("Invalid file request"));
  if(!github.browseReady())return ResponseEntity.status(503).body(new ApiError("GitHub App provider is unavailable"));
  try{return ResponseEntity.ok(Map.of("commitSha",github.addFile(checked.account().githubId(),id,repo,request.branch(),request.path(),request.content(),request.message(),request.expectedHeadSha(),request.placeholder())));}
  catch(GithubAppProvider.TargetConflictException e){return ResponseEntity.status(409).body(new ApiError("Repository changed or target path is unavailable; refresh before retrying"));}
  catch(IllegalArgumentException e){return ResponseEntity.badRequest().body(new ApiError("Invalid file request"));}
  catch(SecurityException e){return ResponseEntity.status(403).body(new ApiError("Repository is not available to this account"));}
  catch(Exception e){return ResponseEntity.status(503).body(new ApiError("File commit outcome could not be confirmed; refresh before retrying"));}
 }
 @PostMapping("/installations/{id}/repositories/{repo}/tree-operations/preview") public ResponseEntity<?> previewTreeOperation(Authentication a,@RequestHeader(value=GithubAccountAssertion.HEADER,required=false) String expected,@PathVariable long id,@PathVariable long repo,@RequestBody TreeOperationPreviewRequest request){
  var checked=GithubAccountAssertion.require(a,expected,users);
  if(!checked.accepted())return checked.failure();
  if(request==null)return ResponseEntity.badRequest().body(new ApiError("Invalid tree operation request"));
  if(!github.browseReady())return ResponseEntity.status(503).body(new ApiError("GitHub App provider is unavailable"));
  try{return ResponseEntity.ok(github.previewOperation(checked.account().githubId(),id,repo,new GithubAppProvider.OperationPreviewRequest(request.operation(),request.branch(),request.sourcePath(),request.destinationPath(),request.message(),request.expectedHeadSha())));}
  catch(GithubAppProvider.TargetConflictException e){return ResponseEntity.status(409).body(new ApiError("Repository changed or tree operation is unsafe; refresh before retrying"));}
  catch(IllegalArgumentException e){return ResponseEntity.badRequest().body(new ApiError("Invalid tree operation request"));}
  catch(SecurityException e){return ResponseEntity.status(403).body(new ApiError("Repository is not available to this account"));}
  catch(Exception e){return ResponseEntity.status(503).body(new ApiError("Tree operation preview could not be confirmed; refresh before retrying"));}
 }
 @PostMapping("/installations/{id}/repositories/{repo}/tree-operations/commit") public ResponseEntity<?> commitTreeOperation(Authentication a,@RequestHeader(value=GithubAccountAssertion.HEADER,required=false) String expected,@PathVariable long id,@PathVariable long repo,@RequestBody TreeOperationCommitRequest request){
  var checked=GithubAccountAssertion.require(a,expected,users);
  if(!checked.accepted())return checked.failure();
  if(request==null)return ResponseEntity.badRequest().body(new ApiError("Invalid tree operation confirmation"));
  if(!github.browseReady())return ResponseEntity.status(503).body(new ApiError("GitHub App provider is unavailable"));
  try{String sha=github.commitOperation(checked.account().githubId(),id,repo,request.previewId());return ResponseEntity.ok(Map.of("commitSha",sha,"recovery","Use GitHub commit "+sha+" to revert this operation if needed."));}
  catch(GithubAppProvider.TargetConflictException e){return ResponseEntity.status(409).body(new ApiError("Repository changed or preview expired; refresh and preview again"));}
  catch(IllegalArgumentException e){return ResponseEntity.badRequest().body(new ApiError("Invalid tree operation confirmation"));}
  catch(SecurityException e){return ResponseEntity.status(403).body(new ApiError("Repository is not available to this account"));}
  catch(Exception e){return ResponseEntity.status(503).body(new ApiError("Tree operation outcome could not be confirmed; check GitHub before retrying"));}
 }
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
