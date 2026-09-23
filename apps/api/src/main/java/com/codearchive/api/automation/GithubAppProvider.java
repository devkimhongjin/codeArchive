package com.codearchive.api.automation;

import com.codearchive.api.settings.UserSettings; import com.codearchive.api.solution.Solution; import com.fasterxml.jackson.databind.*;
import java.math.BigInteger; import java.net.URI; import java.net.URLEncoder; import java.net.http.*; import java.nio.charset.StandardCharsets; import java.security.*; import java.security.interfaces.RSAPrivateKey; import java.security.spec.PKCS8EncodedKeySpec; import java.security.spec.RSAPrivateCrtKeySpec; import java.time.*; import java.time.format.DateTimeFormatter; import java.util.*; import java.util.regex.Matcher; import java.util.regex.Pattern; import org.springframework.beans.factory.annotation.Autowired; import org.springframework.beans.factory.annotation.Value; import org.springframework.stereotype.Component;

/** Server-only GitHub App write path. Every write is based on a newly read branch head and uses a non-force ref update. */
@Component public class GithubAppProvider implements GithubProvider {
 private static final DateTimeFormatter VERSION_TIMESTAMP=DateTimeFormatter.ofPattern("yyyyMMdd-HHmmssSSS").withZone(ZoneOffset.UTC);
 private static final DateTimeFormatter PATH_TIME=DateTimeFormatter.ofPattern("yyMMddHHmmss").withZone(ZoneOffset.UTC);
 public static final String INITIAL_README="# CodeArchive\n\n이 저장소는 CodeArchive로 관리하는 알고리즘 풀이를 보관합니다. 지원 사이트에서 PASS한 풀이가 설정에 따라 자동 수집·동기화·커밋됩니다.\n\n저장된 풀이에는 플랫폼, 문제 번호와 제목, 제출 언어, 소스 코드, 수집 가능한 실행 시간과 메모리 정보가 포함될 수 있습니다. 폴더 구조와 파일명, 커밋 메시지, 문제 정보 주석은 CodeArchive 설정에 따라 달라집니다.\n";
 private final String appId,key,base; private final HttpClient http; private final ObjectMapper json; private final Duration requestTimeout; private final GithubProvider fallback=new FailClosedGithubProvider();
 @Autowired public GithubAppProvider(@Value("${codearchive.github.app-id:}")String appId,@Value("${codearchive.github.app-private-key:}")String key,@Value("${codearchive.github.api-base:https://api.github.com}")String base,@Value("${codearchive.github.connect-timeout-ms:5000}")long connectTimeoutMs,@Value("${codearchive.github.request-timeout-ms:10000}")long requestTimeoutMs,ObjectMapper json){this(appId,key,base,HttpClient.newBuilder().connectTimeout(timeout(connectTimeoutMs)).build(),json,requestTimeoutMs);} 
 GithubAppProvider(String appId,String key,String base,HttpClient http,ObjectMapper json){this(appId,key,base,http,json,10000);}
 GithubAppProvider(String appId,String key,String base,HttpClient http,ObjectMapper json,long requestTimeoutMs){this.appId=appId;this.key=key;this.base=base.replaceAll("/$","");this.http=http;this.json=json;this.requestTimeout=timeout(requestTimeoutMs);}
 public Result createOnly(UserSettings s,Solution solution){ return createOnly(s,solution,()->true); }
 public record InstallationChoice(long id,String accountLogin){} public record RepositoryChoice(long id,String owner,String name,String fullName,boolean privateRepository,String defaultBranch){} public record BranchChoice(String name,boolean protectedBranch,String commitSha){} public record DirectoryChoice(String currentPath,String parentPath,List<String> directories){} public record PageResult<T>(List<T> items,boolean hasMore){}
 public record TreeEntry(String name,String path,String type,long size){} public record TreePage(String path,String headSha,List<TreeEntry> items,int page,boolean hasMore,boolean truncated){}
 public static final class ProviderUnavailableException extends IllegalStateException { public ProviderUnavailableException(String message){super(message);} }
 public static final class EmptyRepositoryConflictException extends IllegalStateException { public EmptyRepositoryConflictException(){super("repository is not empty");} }
 public static final class TargetConflictException extends IllegalStateException { public TargetConflictException(String message){super(message);} }
 public boolean browseReady(){return !appId.isBlank()&&!key.isBlank();}
 public List<InstallationChoice> installations(String githubId)throws Exception{if(!browseReady())throw new ProviderUnavailableException("provider unavailable");if(!safeGithubId(githubId))throw new SecurityException("invalid GitHub identity");List<InstallationChoice> out=new ArrayList<>();for(int page=1;page<=100;page++){Response r=send("GET","/app/installations?per_page=100&page="+page,jwt(),null);if(r.code!=200)throw installationBrowseFailure(r);JsonNode body=json.readTree(r.body);if(!body.isArray())throw new ProviderUnavailableException("installation response invalid");int count=0;for(JsonNode n:body){count++;InstallationChoice choice=installationChoice(n,githubId);if(choice!=null)out.add(choice);}if(count<100)break;}return out;}
 public List<RepositoryChoice> repositories(String githubId,long installation,int page)throws Exception{return repositoriesPage(githubId,installation,page).items();}
 public PageResult<RepositoryChoice> repositoriesPage(String githubId,long installation,int page)throws Exception{
  checkPage(page);verifyInstallation(githubId,installation);
  Response r=send("GET","/installation/repositories?per_page=100&page="+page,installationToken(installation),null);
  if(r.code!=200)throw new IllegalStateException("repositories unavailable");
  JsonNode raw=json.readTree(r.body).path("repositories");
  if(!raw.isArray())throw new ProviderUnavailableException("repositories response invalid");
  List<RepositoryChoice> out=new ArrayList<>();int count=0;
  for(JsonNode n:raw){
   count++;
   long id=n.path("id").asLong();String owner=n.path("owner").path("login").asText(),name=n.path("name").asText();
   JsonNode defaultBranch=n.get("default_branch");
   if(defaultBranch==null||(!defaultBranch.isNull()&&!defaultBranch.isTextual()))continue;
   String branch=defaultBranch.isTextual()?defaultBranch.asText():null;
   // GitHub can return a null default branch before the first commit. Keep
   // that repository selectable instead of silently dropping it from setup.
   if(id>0&&safe(owner)&&safe(name)&&(branch==null||safeBranch(branch)))out.add(new RepositoryChoice(id,owner,name,owner+"/"+name,n.path("private").asBoolean(),branch));
  }
  return new PageResult<>(out,count==100&&page<100);
 }
 public List<BranchChoice> branches(String githubId,long installation,long repository,int page)throws Exception{return branchesPage(githubId,installation,repository,page).items();} public PageResult<BranchChoice> branchesPage(String githubId,long installation,long repository,int page)throws Exception{checkPage(page);RepositoryChoice r=repository(githubId,installation,repository);Response x=send("GET","/repos/"+segment(r.owner())+"/"+segment(r.name())+"/branches?per_page=100&page="+page,installationToken(installation),null);if(x.code==409)return new PageResult<>(List.of(),false);if(x.code!=200)throw new IllegalStateException("branches unavailable");JsonNode raw=json.readTree(x.body);if(!raw.isArray())throw new ProviderUnavailableException("branches response invalid");List<BranchChoice> out=new ArrayList<>();int count=0;for(JsonNode n:raw){count++;String name=n.path("name").asText(),sha=n.path("commit").path("sha").asText();if(safeBranch(name)&&sha.matches("[0-9a-fA-F]{40}"))out.add(new BranchChoice(name,n.path("protected").asBoolean(),sha));}return new PageResult<>(out,count==100&&page<100);}
 public DirectoryChoice directories(String githubId,long installation,long repository,String branch,String path)throws Exception{if(!safeBranch(branch)||!safePath(path))throw new IllegalArgumentException("unsafe path");RepositoryChoice r=repository(githubId,installation,repository);if(!branchExists(githubId,installation,repository,branch)){if(path.isBlank()&&branch.equals(emptyDefaultBranch(githubId,installation,repository,installationToken(installation))))return new DirectoryChoice("","",List.of());throw new SecurityException("branch mismatch");}String p=path.isBlank()?"": "/"+Arrays.stream(path.split("/")).map(GithubAppProvider::segment).collect(java.util.stream.Collectors.joining("/"));Response x=send("GET","/repos/"+segment(r.owner())+"/"+segment(r.name())+"/contents"+p+"?ref="+segment(branch),installationToken(installation),null);if(x.code!=200)throw new IllegalStateException("directory unavailable");List<String> dirs=new ArrayList<>();JsonNode body=json.readTree(x.body);if(!body.isArray())throw new IllegalArgumentException("not directory");for(JsonNode n:body){String name=n.path("name").asText();if("dir".equals(n.path("type").asText())&&safe(name)&&dirs.size()<100)dirs.add(name);}String parent=path.isBlank()?"":path.contains("/")?path.substring(0,path.lastIndexOf('/')):"";return new DirectoryChoice(path,parent,dirs);}
 public TreePage treePage(String githubId,long installation,long repository,String branch,String path,int page)throws Exception{
  checkPage(page);
  if(page>50)throw new IllegalArgumentException("tree page out of range");
  if(!safeBranch(branch)||!safePath(path))throw new IllegalArgumentException("unsafe tree path");
  RepositoryChoice target=repository(githubId,installation,repository);
  String token=installationToken(installation);
  String basePath="/repos/"+segment(target.owner())+"/"+segment(target.name());
  Response ref=send("GET",basePath+"/git/ref/heads/"+segment(branch),token,null);
  if(ref.code==404||ref.code==409){
   if(path.isBlank()&&page==1&&branch.equals(emptyDefaultBranch(githubId,installation,repository,token)))return new TreePage("",null,List.of(),1,false,false);
   throw new SecurityException("branch unavailable");
  }
  if(ref.code!=200)throw new ProviderUnavailableException("branch reference unavailable");
  String head=json.readTree(ref.body).path("object").path("sha").asText();
  if(!sha(head))throw new ProviderUnavailableException("branch reference invalid");
  Response commit=send("GET",basePath+"/git/commits/"+head,token,null);
  if(commit.code!=200)throw new ProviderUnavailableException("branch commit unavailable");
  String treeSha=json.readTree(commit.body).path("tree").path("sha").asText();
  if(!sha(treeSha))throw new ProviderUnavailableException("branch tree invalid");
  JsonNode tree=readTree(basePath,treeSha,token);
  if(!path.isBlank())for(String part:path.split("/")){
   String next=null;
   for(JsonNode entry:tree.path("tree"))if("tree".equals(entry.path("type").asText())&&part.equals(entry.path("path").asText())){next=entry.path("sha").asText();break;}
   if(!sha(next)){
    if(tree.path("truncated").asBoolean())throw new ProviderUnavailableException("tree traversal truncated");
    throw new SecurityException("directory unavailable");
   }
   tree=readTree(basePath,next,token);
  }
  JsonNode raw=tree.path("tree");
  if(!raw.isArray())throw new ProviderUnavailableException("tree response invalid");
  int available=Math.min(raw.size(),5000),start=(page-1)*100,end=Math.min(start+100,available);
  List<TreeEntry> items=new ArrayList<>();
  boolean omitted=false;
  for(int index=start;index<end;index++){
   JsonNode entry=raw.get(index);String name=entry.path("path").asText(),type=entry.path("type").asText();
   if(name.isBlank()||name.length()>255||name.contains("/")||name.contains("\\")||name.equals(".")||name.equals("..")||name.chars().anyMatch(c->c<32)||!(type.equals("tree")||type.equals("blob")||type.equals("commit"))){omitted=true;continue;}
   items.add(new TreeEntry(name,path.isBlank()?name:path+"/"+name,type,Math.max(0,entry.path("size").asLong(0))));
  }
  return new TreePage(path,head,items,page,end<available,tree.path("truncated").asBoolean()||raw.size()>available||omitted);
 }
 private JsonNode readTree(String basePath,String sha,String token)throws Exception{
  Response result=send("GET",basePath+"/git/trees/"+sha,token,null);
  if(result.code!=200)throw new ProviderUnavailableException("repository tree unavailable");
  JsonNode body=json.readTree(result.body);
  if(!body.isObject()||!body.path("tree").isArray()||!body.path("truncated").isBoolean())throw new ProviderUnavailableException("tree response invalid");
  return body;
 }
 private static boolean sha(String value){return value!=null&&value.matches("[0-9a-fA-F]{40}");}
 /** Adds one new file or one folder placeholder without changing an existing path. */
 public String addFile(String githubId,long installation,long repository,String branch,String path,String content,String message,String expectedHead,boolean placeholder)throws Exception{
  if(!safeBranch(branch)||!safePath(path)||path.isBlank()||!sha(expectedHead)||content==null||content.getBytes(StandardCharsets.UTF_8).length>65536||message==null||message.isBlank()||message.length()>200||message.chars().anyMatch(c->c<32||c==127))throw new IllegalArgumentException("invalid file request");
  String[] parts=path.split("/");
  if(placeholder&&(parts.length<2||!parts[parts.length-1].equals(".gitkeep")||!content.isEmpty()))throw new IllegalArgumentException("invalid folder placeholder");
  if(!placeholder&&parts[parts.length-1].equalsIgnoreCase(".gitkeep"))throw new IllegalArgumentException("placeholder requires folder confirmation");
  RepositoryChoice target=repository(githubId,installation,repository);
  BranchChoice selected=null;
  for(int page=1;page<=100;page++){
   PageResult<BranchChoice> choices=branchesPage(githubId,installation,repository,page);
   selected=choices.items().stream().filter(item->item.name().equals(branch)).findFirst().orElse(null);
   if(selected!=null||!choices.hasMore())break;
  }
  if(selected==null)throw new TargetConflictException("branch unavailable");
  if(selected.protectedBranch())throw new TargetConflictException("protected branch");
  String token=installationToken(installation),repoPath="/repos/"+segment(target.owner())+"/"+segment(target.name()),refPath=repoPath+"/git/ref/heads/"+segment(branch);
  Response ref=send("GET",refPath,token,null);
  if(ref.code!=200)throw new ProviderUnavailableException("branch reference unavailable");
  JsonNode reference=json.readTree(ref.body);
  String head=reference.path("object").path("sha").asText();
  if(!("refs/heads/"+branch).equals(reference.path("ref").asText())||!sha(head))throw new ProviderUnavailableException("branch reference invalid");
  if(!head.equalsIgnoreCase(expectedHead))throw new TargetConflictException("branch moved");
  Response commit=send("GET",repoPath+"/git/commits/"+head,token,null);
  if(commit.code!=200)throw new ProviderUnavailableException("branch commit unavailable");
  String rootSha=json.readTree(commit.body).path("tree").path("sha").asText();
  if(!sha(rootSha))throw new ProviderUnavailableException("branch tree invalid");
  JsonNode current=readTree(repoPath,rootSha,token);
  int parentCount=parts.length-1;
  for(int index=0;index<parentCount;index++){
   if(current.path("truncated").asBoolean())throw new ProviderUnavailableException("tree traversal truncated");
   String next=null;
   for(JsonNode entry:current.path("tree")){
    String entryName=entry.path("path").asText();
    if(entryName.equalsIgnoreCase(parts[index])){
     if(next!=null||!entryName.equals(parts[index])||!"tree".equals(entry.path("type").asText()))throw new TargetConflictException("path collision");
     next=entry.path("sha").asText();
    }
   }
   if(next==null){
    if(!placeholder||index!=parentCount-1)throw new TargetConflictException("parent directory unavailable");
    current=null;break;
   }
   if(!sha(next))throw new ProviderUnavailableException("directory tree invalid");
   current=readTree(repoPath,next,token);
  }
  if(current!=null){
   if(current.path("truncated").asBoolean())throw new ProviderUnavailableException("tree traversal truncated");
   for(JsonNode entry:current.path("tree"))if(entry.path("path").asText().equalsIgnoreCase(parts[parts.length-1]))throw new TargetConflictException("file already exists");
   if(placeholder)throw new TargetConflictException("folder already exists");
  }
  Response fresh=send("GET",refPath,token,null);
  if(fresh.code!=200)throw new ProviderUnavailableException("branch reference unavailable");
  JsonNode freshReference=json.readTree(fresh.body);
  if(!("refs/heads/"+branch).equals(freshReference.path("ref").asText())||!head.equals(freshReference.path("object").path("sha").asText()))throw new TargetConflictException("branch moved");
  Response newTree=send("POST",repoPath+"/git/trees",token,json.writeValueAsString(Map.of("base_tree",rootSha,"tree",List.of(Map.of("path",path,"mode","100644","type","blob","content",content)))));
  if(newTree.code!=201)throw new ProviderUnavailableException("file tree creation outcome unavailable");
  String newTreeSha=json.readTree(newTree.body).path("sha").asText();
  if(!sha(newTreeSha))throw new ProviderUnavailableException("file tree response invalid");
  Response newCommit=send("POST",repoPath+"/git/commits",token,json.writeValueAsString(Map.of("message",message,"tree",newTreeSha,"parents",List.of(head))));
  if(newCommit.code!=201)throw new ProviderUnavailableException("file commit creation outcome unavailable");
  String commitSha=json.readTree(newCommit.body).path("sha").asText();
  if(!sha(commitSha))throw new ProviderUnavailableException("file commit response invalid");
  Response latest=send("GET",refPath,token,null);
  if(latest.code!=200)throw new ProviderUnavailableException("branch reference unavailable");
  JsonNode latestReference=json.readTree(latest.body);
  if(!("refs/heads/"+branch).equals(latestReference.path("ref").asText())||!head.equals(latestReference.path("object").path("sha").asText()))throw new TargetConflictException("branch moved");
  Response update=send("PATCH",repoPath+"/git/refs/heads/"+segment(branch),token,json.writeValueAsString(Map.of("sha",commitSha,"force",false)));
  if(update.code==200){
   JsonNode updated=json.readTree(update.body);
   if(("refs/heads/"+branch).equals(updated.path("ref").asText())&&commitSha.equals(updated.path("object").path("sha").asText()))return commitSha;
   throw new ProviderUnavailableException("file commit response invalid");
  }
  if(update.code==409||update.code==422)throw new TargetConflictException("branch update rejected");
  throw new ProviderUnavailableException("file commit outcome unavailable");
 }
 public void validateTarget(String githubId,long installation,long repository,String branch,String root)throws Exception{directories(githubId,installation,repository,branch,root==null?"":root);}
 public String initializeReadme(String githubId,long installation,long repository)throws Exception{
  String token=installationToken(installation);
  String branch=emptyDefaultBranch(githubId,installation,repository,token);
  RepositoryChoice target=repository(githubId,installation,repository);
  String path="/repos/"+segment(target.owner())+"/"+segment(target.name())+"/contents/README.md";
  Response created=send("PUT",path,token,json.writeValueAsString(Map.of("message","Initialize CodeArchive archive","content",Base64.getEncoder().encodeToString(INITIAL_README.getBytes(StandardCharsets.UTF_8)))));
  if(created.code==201)return branch;
  if(created.code==409||created.code==422)throw new EmptyRepositoryConflictException();
  throw new ProviderUnavailableException("README initialization outcome is unavailable");
 }
 public String emptyDefaultBranch(String githubId,long installation,long repository)throws Exception{
  return emptyDefaultBranch(githubId,installation,repository,installationToken(installation));
 }
 private String emptyDefaultBranch(String githubId,long installation,long repository,String token)throws Exception{
  RepositoryChoice target=repository(githubId,installation,repository);
  String repoPath="/repos/"+segment(target.owner())+"/"+segment(target.name());
  Response metadata=send("GET",repoPath,token,null);
  if(metadata.code!=200)throw new ProviderUnavailableException("repository metadata unavailable");
  JsonNode details=json.readTree(metadata.body);
  if(details.path("id").asLong()!=repository)throw new ProviderUnavailableException("repository identity changed");
  String branch=details.path("default_branch").asText();
  if(!safeBranch(branch))throw new ProviderUnavailableException("default branch unavailable");
  Response branches=send("GET",repoPath+"/branches?per_page=1&page=1",token,null);
  if(branches.code!=409){
   if(branches.code!=200)throw new ProviderUnavailableException("branch verification unavailable");
   JsonNode listed=json.readTree(branches.body);
   if(!listed.isArray())throw new ProviderUnavailableException("branch response invalid");
   if(!listed.isEmpty())throw new EmptyRepositoryConflictException();
  }
  Response ref=send("GET",repoPath+"/git/ref/heads/"+segment(branch),token,null);
  if(ref.code!=404&&ref.code!=409){if(ref.code==200)throw new EmptyRepositoryConflictException();throw new ProviderUnavailableException("empty repository verification unavailable");}
  return branch;
 }
 private RepositoryChoice repository(String githubId,long installation,long id)throws Exception{for(int page=1;page<=100;page++){PageResult<RepositoryChoice> result=repositoriesPage(githubId,installation,page);Optional<RepositoryChoice> found=result.items().stream().filter(x->x.id()==id).findFirst();if(found.isPresent())return found.get();if(!result.hasMore())break;}throw new SecurityException("repository mismatch");}
 private boolean branchExists(String githubId,long installation,long repository,String branch)throws Exception{for(int page=1;page<=100;page++){PageResult<BranchChoice> result=branchesPage(githubId,installation,repository,page);if(result.items().stream().anyMatch(value->value.name().equals(branch)))return true;if(!result.hasMore())break;}return false;}
 private void verifyInstallation(String githubId,long installation)throws Exception{if(installations(githubId).stream().noneMatch(x->x.id()==installation))throw new SecurityException("installation mismatch");}
 private static void checkPage(int p){if(p<1||p>100)throw new IllegalArgumentException("page");} private static boolean safe(String x){return x!=null&&x.matches("[A-Za-z0-9_.-]{1,100}");} private static boolean safeGithubId(String x){return x!=null&&x.matches("[0-9]{1,20}");} private static boolean sameGithubId(String left,String right){try{return safeGithubId(left)&&safeGithubId(right)&&new BigInteger(left).equals(new BigInteger(right));}catch(NumberFormatException e){return false;}} private static boolean safeBranch(String x){return x!=null&&x.length()<=255&&!x.isBlank()&&!x.startsWith("-")&&!x.contains("..")&&!x.contains("@{")&&!x.chars().anyMatch(c->Character.isWhitespace(c)||c<32||"~^:?*[\\\\".indexOf(c)>=0);} private static boolean safePath(String x){if(x==null||x.length()>1024||x.startsWith("/")||x.contains("\\\\")||x.contains(".."))return false;return x.isBlank()||Arrays.stream(x.split("/",-1)).allMatch(s->safe(s)&&!s.equals(".")&&!s.equalsIgnoreCase(".git"));}
 @Override public Result createOnly(UserSettings s,Solution solution,FinalWriteGuard finalWriteGuard){
  if(appId.isBlank()||key.isBlank()||s.getGithubInstallationId()==null)return fallback.createOnly(s,solution);
  final String path,source; try { path=path(s,solution);source=source(s,solution); } catch (IllegalArgumentException e) { return Result.failed("Unsafe Git path"); }
  boolean possibleWrite=false;
  try {
   String token=installationToken(s.getGithubInstallationId()); String repo=repo(s);
   Response ref=send("GET",repo+"/git/ref/heads/"+segment(s.getGithubBranch()),token,null);
   if(ref.code==404||ref.code==409)return createFirstSolution(s,solution,finalWriteGuard,token,repo,path,source);
   if(ref.code!=200)return classify(ref,false);
   String head=json.readTree(ref.body).path("object").path("sha").asText(); if(head.isBlank())return Result.unknown("Malformed branch reference");
   Response commit=send("GET",repo+"/git/commits/"+segment(head),token,null); if(commit.code!=200)return classify(commit,false);
   String tree=json.readTree(commit.body).path("tree").path("sha").asText(); if(tree.isBlank())return Result.unknown("Malformed commit");
   String targetPath=path;
   // GitHub otherwise checks the repository default branch. The ref is the
   // freshly observed target head, so create/update remains branch-correct.
   Response exists=send("GET",repo+"/contents/"+encodedPath(path)+"?ref="+segment(head),token,null);
   if(exists.code==200){
    ExistingFileState existing=existingFileState(exists,source);if(existing==ExistingFileState.IDENTICAL)return Result.succeeded();if(existing==ExistingFileState.CONFLICT)return Result.failed("Git path is not an updatable file");
    targetPath=versionedPath(path,solution);
    Response versioned=send("GET",repo+"/contents/"+encodedPath(targetPath)+"?ref="+segment(head),token,null);
    if(versioned.code==200){ExistingFileState state=existingFileState(versioned,source);if(state==ExistingFileState.IDENTICAL)return Result.succeeded();return Result.failed("Versioned Git path already exists");}else if(versioned.code!=404)return classify(versioned,false);
   }else if(exists.code!=404)return classify(exists,false);
   possibleWrite=true;
   Response blob=send("POST",repo+"/git/blobs",token,json.writeValueAsString(Map.of("content",Base64.getEncoder().encodeToString(source.getBytes(StandardCharsets.UTF_8)),"encoding","base64"))); if(blob.code!=201)return Result.unknown("Blob creation was not confirmed");
   String blobSha=json.readTree(blob.body).path("sha").asText();
   Response newTree=send("POST",repo+"/git/trees",token,json.writeValueAsString(Map.of("base_tree",tree,"tree",List.of(Map.of("path",targetPath,"mode","100644","type","blob","sha",blobSha))))); if(newTree.code!=201)return Result.unknown("Tree creation was not confirmed");
   String treeSha=json.readTree(newTree.body).path("sha").asText();
   Response newCommit=send("POST",repo+"/git/commits",token,json.writeValueAsString(Map.of("message",commitMessage(s,solution),"tree",treeSha,"parents",List.of(head)))); if(newCommit.code!=201)return Result.unknown("Commit creation was not confirmed");
   String commitSha=json.readTree(newCommit.body).path("sha").asText();
   // The durable worker re-reads consent/settings at the latest safe point.
   // Never expose a ref update once logout, target, or automation consent changed.
   if(!finalWriteGuard.stillAuthorized())return Result.failed("GitHub automation consent changed before final write");
   Response freshRef=send("GET",repo+"/git/ref/heads/"+segment(s.getGithubBranch()),token,null);
   if(freshRef.code!=200)return Result.unknown("Fresh branch reference was not confirmed");
   String freshHead=json.readTree(freshRef.body).path("object").path("sha").asText();
   if(!head.equals(freshHead))return Result.unknown("Branch moved before final ref update");
   // The ref GET itself is network I/O. Recheck consent in the tiny final
   // window before the visible mutation as logout/OFF may have happened there.
   if(!finalWriteGuard.stillAuthorized())return Result.failed("GitHub automation consent changed before final write");
   Response update=send("PATCH",repo+"/git/refs/heads/"+segment(s.getGithubBranch()),token,json.writeValueAsString(Map.of("sha",commitSha,"force",false)));
   if(update.code==200)return Result.succeeded(); return Result.unknown("Final ref update was not confirmed");
  } catch(Exception e){return possibleWrite?Result.unknown("GitHub mutation outcome is unknown"):Result.retryable("GitHub App request failed before final mutation");}
 }
 private Result createFirstSolution(UserSettings settings,Solution solution,FinalWriteGuard guard,String token,String repo,String path,String source){
  // The Contents API is the documented bootstrap path for an empty GitHub
  // repository. No sha is supplied, so an existing path is never overwritten.
  try{
   if(settings.getGithubRootPath()!=null&&!settings.getGithubRootPath().isBlank())return Result.failed("Empty repository root must be blank");
   long installation=settings.getGithubInstallationId();
   RepositoryChoice target=repository(settings.getUser().getGithubId(),installation,findRepositoryId(settings.getUser().getGithubId(),installation,settings.getGithubOwner(),settings.getGithubRepository()));
   if(!target.owner().equals(settings.getGithubOwner())||!target.name().equals(settings.getGithubRepository()))return Result.failed("GitHub target changed");
   String branch=emptyDefaultBranch(settings.getUser().getGithubId(),installation,target.id(),token);
   if(!branch.equals(settings.getGithubBranch()))return Result.failed("Default branch changed");
   if(!guard.stillAuthorized())return Result.failed("GitHub automation consent changed before first commit");
   String body=json.writeValueAsString(Map.of("message",commitMessage(settings,solution),"content",Base64.getEncoder().encodeToString(source.getBytes(StandardCharsets.UTF_8))));
   Response created=send("PUT",repo+"/contents/"+encodedPath(path),token,body);
   if(created.code==201)return Result.succeeded();
   if(created.code==409||created.code==422)return Result.unknown("First commit collided with another repository change");
   return Result.unknown("First commit outcome was not confirmed");
  }catch(EmptyRepositoryConflictException e){return Result.retryable("Repository initialized before first commit; retry against its branch");}
   catch(SecurityException e){return Result.failed("GitHub target is no longer available");}
   catch(Exception e){return Result.unknown("First commit preflight or outcome was not confirmed");}
 }
 private long findRepositoryId(String githubId,long installation,String owner,String name)throws Exception{
  for(int page=1;page<=100;page++){
   PageResult<RepositoryChoice> result=repositoriesPage(githubId,installation,page);
   for(RepositoryChoice item:result.items())if(item.owner().equals(owner)&&item.name().equals(name))return item.id();
   if(!result.hasMore())break;
  }
  throw new SecurityException("repository mismatch");
 }
 private String installationToken(Long id)throws Exception{Response r=send("POST","/app/installations/"+id+"/access_tokens",jwt(),"{}");if(r.code!=201)throw new IllegalStateException("installation token unavailable");return json.readTree(r.body).path("token").asText();}
 private Response send(String method,String path,String token,String body)throws Exception{HttpRequest.Builder b=HttpRequest.newBuilder(URI.create(base+path)).timeout(requestTimeout).header("Accept","application/vnd.github+json").header("Authorization","Bearer "+token).header("X-GitHub-Api-Version","2022-11-28"); if(body==null)b.method(method,HttpRequest.BodyPublishers.noBody());else b.header("Content-Type","application/json").method(method,HttpRequest.BodyPublishers.ofString(body));HttpResponse<String> r=http.send(b.build(),HttpResponse.BodyHandlers.ofString());return new Response(r.statusCode(),r.body());}
 private static Duration timeout(long millis){return Duration.ofMillis(Math.max(100,Math.min(30000,millis)));}
 private static InstallationChoice installationChoice(JsonNode node,String githubId){if(!node.isObject()||!node.has("id")||!node.path("id").isIntegralNumber()||!node.path("id").canConvertToLong()||node.path("id").asLong()<=0)throw new ProviderUnavailableException("installation response invalid");JsonNode account=node.path("account"),accountId=account.path("id"),login=account.path("login"),type=account.path("type"),suspended=node.path("suspended_at");if(!account.isObject()||!accountId.isIntegralNumber()||!safeGithubId(accountId.asText())||!login.isTextual()||!safe(login.asText())||!type.isTextual()||!("User".equals(type.asText())||"Organization".equals(type.asText()))||!(suspended.isNull()||suspended.isTextual()))throw new ProviderUnavailableException("installation response invalid");if(!"User".equals(type.asText())||!sameGithubId(accountId.asText(),githubId)||suspended.isTextual())return null;return new InstallationChoice(node.path("id").asLong(),login.asText());}
 private static ProviderUnavailableException installationBrowseFailure(Response r){if(r.code==429||r.code>=500)return new ProviderUnavailableException("GitHub installation provider is temporarily unavailable");if(r.code==401||r.code==403)return new ProviderUnavailableException("GitHub App authentication is unavailable");return new ProviderUnavailableException("GitHub installation response was unavailable");}
 private Result classify(Response r,boolean finalWrite){if(r.code>=500||r.code==429)return Result.retryable("GitHub unavailable");return Result.failed("GitHub rejected request");}
 private String jwt()throws Exception{long now=Instant.now().getEpochSecond();String h=b64("{\"alg\":\"RS256\",\"typ\":\"JWT\"}"),p=b64("{\"iat\":"+(now-30)+",\"exp\":"+(now+540)+",\"iss\":\""+appId+"\"}");Signature sig=Signature.getInstance("SHA256withRSA");sig.initSign(privateKey());sig.update((h+"."+p).getBytes(StandardCharsets.UTF_8));return h+"."+p+"."+Base64.getUrlEncoder().withoutPadding().encodeToString(sig.sign());}
 /** GitHub provides both PKCS#8 and the older PKCS#1 RSA PEM form.  Keep this
  * parser local so accepting the latter does not pull a crypto/provider dependency
  * into the API. */
 private RSAPrivateKey privateKey()throws Exception{
  String pem=key.replace("\\n","\n"); boolean pkcs1=pem.contains("-----BEGIN RSA PRIVATE KEY-----");
  String body=pem.replaceAll("-----[^-]+-----","").replaceAll("\\s",""); byte[] der=Base64.getDecoder().decode(body); KeyFactory factory=KeyFactory.getInstance("RSA");
  if(!pkcs1)return (RSAPrivateKey)factory.generatePrivate(new PKCS8EncodedKeySpec(der));
  DerReader sequence=new DerReader(der).sequence(); sequence.integer(); // version
  return (RSAPrivateKey)factory.generatePrivate(new RSAPrivateCrtKeySpec(sequence.integer(),sequence.integer(),sequence.integer(),sequence.integer(),sequence.integer(),sequence.integer(),sequence.integer(),sequence.integer()));
 }
 private static final class DerReader{
  private final byte[] data; private int cursor;
  DerReader(byte[] data){this.data=data;}
  DerReader sequence(){if(readByte()!=0x30)throw new IllegalArgumentException("PKCS#1 key is not a DER sequence");int length=length();if(length!=data.length-cursor)throw new IllegalArgumentException("Invalid PKCS#1 sequence length");byte[] nested=Arrays.copyOfRange(data,cursor,cursor+length);cursor+=length;return new DerReader(nested);}
  BigInteger integer(){if(readByte()!=0x02)throw new IllegalArgumentException("Invalid PKCS#1 integer");int length=length();if(length<1||cursor+length>data.length)throw new IllegalArgumentException("Invalid PKCS#1 integer length");byte[] value=Arrays.copyOfRange(data,cursor,cursor+length);cursor+=length;return new BigInteger(1,value);}
  private int readByte(){if(cursor>=data.length)throw new IllegalArgumentException("Truncated PKCS#1 key");return data[cursor++]&0xff;}
  private int length(){int first=readByte();if((first&0x80)==0)return first;int count=first&0x7f;if(count<1||count>4||cursor+count>data.length)throw new IllegalArgumentException("Invalid PKCS#1 length");int result=0;for(int i=0;i<count;i++)result=(result<<8)|readByte();if(result<128||cursor+result>data.length)throw new IllegalArgumentException("Invalid PKCS#1 length");return result;}
 }
 private String b64(String s){return Base64.getUrlEncoder().withoutPadding().encodeToString(s.getBytes(StandardCharsets.UTF_8));}
 private String repo(UserSettings s){return "/repos/"+segment(s.getGithubOwner())+"/"+segment(s.getGithubRepository());}
 private ExistingFileState existingFileState(Response response,String expectedSource){
  try {
   JsonNode body=json.readTree(response.body); if(!"file".equals(body.path("type").asText())||!"base64".equals(body.path("encoding").asText()))return ExistingFileState.CONFLICT;
   String encoded=body.path("content").asText(); if(encoded.isBlank())return ExistingFileState.CONFLICT;
   byte[] remote=Base64.getMimeDecoder().decode(encoded); byte[] local=expectedSource.getBytes(StandardCharsets.UTF_8);
   return MessageDigest.isEqual(remote,local)?ExistingFileState.IDENTICAL:ExistingFileState.DIFFERENT;
  } catch(Exception ignored){return ExistingFileState.CONFLICT;}
 }
 private String source(UserSettings settings,Solution solution){
  String source=solution.getSourceCode();if(!settings.isGithubHeader())return source;
  String ext=extension(solution.getLanguage()),prefix=List.of("py","rb").contains(ext)?"#":"sql".equals(ext)?"--":"txt".equals(ext)?"":"//";if(prefix.isBlank())return source;
  List<String> lines=new ArrayList<>();lines.add(solution.getPlatform().name()+" #"+solution.getProblemNumber()+" · "+solution.getTitle());lines.add(solution.getProblemUrl());lines.add("Language: "+solution.getLanguage());
  if(solution.getExecutionTime()!=null)lines.add("Execution Time: "+decimal(solution.getExecutionTime())+" ms");
  if(solution.getMemoryValue()!=null&&solution.getMemoryUnit()!=null&&!solution.getMemoryUnit().isBlank()&&!"UNKNOWN".equalsIgnoreCase(solution.getMemoryUnit()))lines.add("Memory: "+decimal(solution.getMemoryValue())+" "+solution.getMemoryUnit());else if(solution.getMemoryUsage()!=null)lines.add("Memory: "+decimal(solution.getMemoryUsage())+" (unit unknown)");
  String header=lines.stream().map(line->prefix+" "+metadataLine(line,ext)).collect(java.util.stream.Collectors.joining("\n"))+"\n\n";
  if(source.startsWith("#!")){int newline=source.indexOf('\n');if(newline>=0)return source.substring(0,newline+1)+header+source.substring(newline+1);}
  return header+source;
 }
 private static String decimal(java.math.BigDecimal value){return value.stripTrailingZeros().toPlainString();}
 private static String metadataLine(String value,String extension){String line=value==null?"":value.replaceAll("[\\r\\n\\u2028\\u2029]"," ");return "java".equals(extension)?line.replace('\\','/'):line;}
 private static String segment(String value){if(value==null||value.isBlank())throw new IllegalArgumentException("blank path component");return URLEncoder.encode(value,StandardCharsets.UTF_8).replace("+","%20");}
 private static String encodedPath(String path){return Arrays.stream(path.split("/",-1)).map(GithubAppProvider::segment).collect(java.util.stream.Collectors.joining("/"));}
 private String path(UserSettings s,Solution x){
  Instant solvedAt=x.getSolvedAt()!=null?x.getSolvedAt():x.getObservedAt();
  Map<String,String> v=new HashMap<>(); v.put("platform",x.getPlatform().name());v.put("number",x.getProblemNumber());v.put("title",clean(x.getTitle()));v.put("language",clean(x.getLanguage()));v.put("name",clean(s.getDisplayName()));v.put("nickname",clean(s.getNickname()));v.put("id",s.getUser()!=null&&s.getUser().getId()!=null?String.valueOf(s.getUser().getId()):"");v.put("time",PATH_TIME.format(solvedAt==null?Instant.EPOCH:solvedAt));v.put("capture_ID",x.getCaptureId()==null?"":clean(x.getCaptureId()));
  String p=render(s.getGitPathTemplate(),v);
  String root=s.getGithubRootPath();if(root!=null&&!root.isBlank())p=root.replaceAll("^/+|/+$","")+"/"+p;
  if(p.isBlank()||p.startsWith("/")||p.startsWith("\\\\")||p.matches("^[A-Za-z]:.*")||p.contains("..")||p.chars().anyMatch(c->c<32||c==127))throw new IllegalArgumentException("unsafe");
  p=Arrays.stream(p.split("/",-1)).map(this::clean).filter(x1->!x1.isBlank()).collect(java.util.stream.Collectors.joining("/"));if(p.isBlank())throw new IllegalArgumentException("empty");
  String ext=extension(x.getLanguage());p=p.replaceFirst("(?i)\\.(java|kt|py|js|ts|c|cpp|cs|go|rs|rb|swift|scala|sql|txt)$","");return p+"."+ext;
 }
 private String versionedPath(String path,Solution solution){
  Instant solvedAt=solution.getSolvedAt()!=null?solution.getSolvedAt():solution.getObservedAt();String timestamp=VERSION_TIMESTAMP.format(solvedAt==null?Instant.EPOCH:solvedAt);
  String capture=solution.getCaptureId()==null?"unknown":solution.getCaptureId().replaceAll("[^A-Za-z0-9]","");if(capture.length()>8)capture=capture.substring(0,8);if(capture.isBlank())capture="unknown";
  int slash=path.lastIndexOf('/'),dot=path.lastIndexOf('.');if(dot<=slash)dot=path.length();return path.substring(0,dot)+"_"+timestamp+"_"+capture+path.substring(dot);
 }
 private String commitMessage(UserSettings s,Solution x){
  Map<String,String> v=new HashMap<>();String platform=x.getPlatform().name();v.put("Platform",platform);v.put("platform",platform);v.put("number",x.getProblemNumber());v.put("title",x.getTitle());v.put("language",x.getLanguage());v.put("name",s.getDisplayName()==null?"":s.getDisplayName().trim());v.put("nickname",s.getNickname()==null?"":s.getNickname().trim());v.put("id",s.getUser()!=null&&s.getUser().getId()!=null?String.valueOf(s.getUser().getId()):"");
  String message=render(s.getGithubCommitMessageTemplate(),v).replaceAll("[\\r\\n\\u2028\\u2029\\x00-\\x1f\\x7f]+"," ").replaceAll("\\s+"," ").trim();
  if(message.isBlank())message="Add "+platform+" "+x.getProblemNumber()+" solution";
  return message.length()>200?message.substring(0,200).trim():message;
 }
 private String clean(String value){return value==null?"":value.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f\\x7f]","-").replaceAll("[. ]+$","").replaceFirst("^\\.+","").trim();}
 private static String render(String template,Map<String,String> values){if(template==null)return "";Matcher matcher=Pattern.compile("\\{([^{}]+)\\}").matcher(template);StringBuffer out=new StringBuffer();while(matcher.find())matcher.appendReplacement(out,Matcher.quoteReplacement(values.getOrDefault(matcher.group(1),"")));matcher.appendTail(out);return out.toString();}
 private String extension(String n){n=n==null?"":n.toLowerCase(Locale.ROOT);if(n.contains("python")||n.contains("pypy"))return"py";if(n.contains("typescript")||n.equals("ts"))return"ts";if(n.contains("javascript")||n.equals("js"))return"js";if(n.contains("kotlin"))return"kt";if(n.contains("java"))return"java";if(n.contains("c++")||n.contains("cpp"))return"cpp";if(n.matches("^c(?:\\s|\\d|$).*"))return"c";if(n.equals("c#")||n.startsWith("c# ")||n.contains("csharp"))return"cs";if(n.equals("go")||n.startsWith("go "))return"go";if(n.contains("rust"))return"rs";if(n.contains("ruby"))return"rb";if(n.contains("swift"))return"swift";if(n.contains("scala"))return"scala";if(n.contains("sql"))return"sql";return"txt";} private enum ExistingFileState{IDENTICAL,DIFFERENT,CONFLICT} private record Response(int code,String body){}
}
