package com.codearchive.api.automation;

import com.codearchive.api.settings.UserSettings; import com.codearchive.api.solution.Solution; import com.fasterxml.jackson.databind.*;
import java.math.BigInteger; import java.net.URI; import java.net.URLEncoder; import java.net.http.*; import java.nio.charset.StandardCharsets; import java.security.*; import java.security.interfaces.RSAPrivateKey; import java.security.spec.PKCS8EncodedKeySpec; import java.security.spec.RSAPrivateCrtKeySpec; import java.time.*; import java.time.format.DateTimeFormatter; import java.util.*; import java.util.regex.Matcher; import java.util.regex.Pattern; import org.springframework.beans.factory.annotation.Autowired; import org.springframework.beans.factory.annotation.Value; import org.springframework.stereotype.Component;

/** Server-only GitHub App write path. Every write is based on a newly read branch head and uses a non-force ref update. */
@Component public class GithubAppProvider implements GithubProvider {
 private static final DateTimeFormatter VERSION_TIMESTAMP=DateTimeFormatter.ofPattern("yyyyMMdd-HHmmssSSS").withZone(ZoneOffset.UTC);
 private static final DateTimeFormatter PATH_TIME=DateTimeFormatter.ofPattern("yyMMddHHmmss").withZone(ZoneOffset.UTC);
 private final String appId,key,base; private final HttpClient http; private final ObjectMapper json; private final Duration requestTimeout; private final GithubProvider fallback=new FailClosedGithubProvider();
 @Autowired public GithubAppProvider(@Value("${codearchive.github.app-id:}")String appId,@Value("${codearchive.github.app-private-key:}")String key,@Value("${codearchive.github.api-base:https://api.github.com}")String base,@Value("${codearchive.github.connect-timeout-ms:5000}")long connectTimeoutMs,@Value("${codearchive.github.request-timeout-ms:10000}")long requestTimeoutMs,ObjectMapper json){this(appId,key,base,HttpClient.newBuilder().connectTimeout(timeout(connectTimeoutMs)).build(),json,requestTimeoutMs);} 
 GithubAppProvider(String appId,String key,String base,HttpClient http,ObjectMapper json){this(appId,key,base,http,json,10000);}
 GithubAppProvider(String appId,String key,String base,HttpClient http,ObjectMapper json,long requestTimeoutMs){this.appId=appId;this.key=key;this.base=base.replaceAll("/$","");this.http=http;this.json=json;this.requestTimeout=timeout(requestTimeoutMs);}
 public Result createOnly(UserSettings s,Solution solution){ return createOnly(s,solution,()->true); }
 public record InstallationChoice(long id,String accountLogin){} public record RepositoryChoice(long id,String owner,String name,String fullName,boolean privateRepository,String defaultBranch){} public record BranchChoice(String name,boolean protectedBranch,String commitSha){} public record DirectoryChoice(String currentPath,String parentPath,List<String> directories){} public record PageResult<T>(List<T> items,boolean hasMore){}
 public static final class ProviderUnavailableException extends IllegalStateException { public ProviderUnavailableException(String message){super(message);} }
 public boolean browseReady(){return !appId.isBlank()&&!key.isBlank();}
 public List<InstallationChoice> installations(String githubId)throws Exception{if(!browseReady())throw new ProviderUnavailableException("provider unavailable");if(!safeGithubId(githubId))throw new SecurityException("invalid GitHub identity");List<InstallationChoice> out=new ArrayList<>();for(int page=1;page<=100;page++){Response r=send("GET","/app/installations?per_page=100&page="+page,jwt(),null);if(r.code!=200)throw installationBrowseFailure(r);JsonNode body=json.readTree(r.body);if(!body.isArray())throw new ProviderUnavailableException("installation response invalid");int count=0;for(JsonNode n:body){count++;InstallationChoice choice=installationChoice(n,githubId);if(choice!=null)out.add(choice);}if(count<100)break;}return out;}
 public List<RepositoryChoice> repositories(String githubId,long installation,int page)throws Exception{return repositoriesPage(githubId,installation,page).items();} public PageResult<RepositoryChoice> repositoriesPage(String githubId,long installation,int page)throws Exception{checkPage(page);verifyInstallation(githubId,installation);Response r=send("GET","/installation/repositories?per_page=100&page="+page,installationToken(installation),null);if(r.code!=200)throw new IllegalStateException("repositories unavailable");JsonNode raw=json.readTree(r.body).path("repositories");List<RepositoryChoice> out=new ArrayList<>();int count=0;for(JsonNode n:raw){count++;long id=n.path("id").asLong();String owner=n.path("owner").path("login").asText(),name=n.path("name").asText(),branch=n.path("default_branch").asText();if(id>0&&safe(owner)&&safe(name)&&safeBranch(branch))out.add(new RepositoryChoice(id,owner,name,owner+"/"+name,n.path("private").asBoolean(),branch));}return new PageResult<>(out,count==100&&page<100);}
 public List<BranchChoice> branches(String githubId,long installation,long repository,int page)throws Exception{return branchesPage(githubId,installation,repository,page).items();} public PageResult<BranchChoice> branchesPage(String githubId,long installation,long repository,int page)throws Exception{checkPage(page);RepositoryChoice r=repository(githubId,installation,repository);Response x=send("GET","/repos/"+segment(r.owner())+"/"+segment(r.name())+"/branches?per_page=100&page="+page,installationToken(installation),null);if(x.code!=200)throw new IllegalStateException("branches unavailable");JsonNode raw=json.readTree(x.body);List<BranchChoice> out=new ArrayList<>();int count=0;for(JsonNode n:raw){count++;String name=n.path("name").asText(),sha=n.path("commit").path("sha").asText();if(safeBranch(name)&&sha.matches("[0-9a-fA-F]{40}"))out.add(new BranchChoice(name,n.path("protected").asBoolean(),sha));}return new PageResult<>(out,count==100&&page<100);}
 public DirectoryChoice directories(String githubId,long installation,long repository,String branch,String path)throws Exception{if(!safeBranch(branch)||!safePath(path))throw new IllegalArgumentException("unsafe path");RepositoryChoice r=repository(githubId,installation,repository);if(!branchExists(githubId,installation,repository,branch))throw new SecurityException("branch mismatch");String p=path.isBlank()?"": "/"+Arrays.stream(path.split("/")).map(GithubAppProvider::segment).collect(java.util.stream.Collectors.joining("/"));Response x=send("GET","/repos/"+segment(r.owner())+"/"+segment(r.name())+"/contents"+p+"?ref="+segment(branch),installationToken(installation),null);if(x.code!=200)throw new IllegalStateException("directory unavailable");List<String> dirs=new ArrayList<>();JsonNode body=json.readTree(x.body);if(!body.isArray())throw new IllegalArgumentException("not directory");for(JsonNode n:body){String name=n.path("name").asText();if("dir".equals(n.path("type").asText())&&safe(name)&&dirs.size()<100)dirs.add(name);}String parent=path.isBlank()?"":path.contains("/")?path.substring(0,path.lastIndexOf('/')):"";return new DirectoryChoice(path,parent,dirs);}
 public void validateTarget(String githubId,long installation,long repository,String branch,String root)throws Exception{directories(githubId,installation,repository,branch,root==null?"":root);}
 private RepositoryChoice repository(String githubId,long installation,long id)throws Exception{for(int page=1;page<=100;page++){PageResult<RepositoryChoice> result=repositoriesPage(githubId,installation,page);Optional<RepositoryChoice> found=result.items().stream().filter(x->x.id()==id).findFirst();if(found.isPresent())return found.get();if(!result.hasMore())break;}throw new SecurityException("repository mismatch");}
 private boolean branchExists(String githubId,long installation,long repository,String branch)throws Exception{for(int page=1;page<=100;page++){PageResult<BranchChoice> result=branchesPage(githubId,installation,repository,page);if(result.items().stream().anyMatch(value->value.name().equals(branch)))return true;if(!result.hasMore())break;}return false;}
 private void verifyInstallation(String githubId,long installation)throws Exception{if(installations(githubId).stream().noneMatch(x->x.id()==installation))throw new SecurityException("installation mismatch");}
 private static void checkPage(int p){if(p<1||p>100)throw new IllegalArgumentException("page");} private static boolean safe(String x){return x!=null&&x.matches("[A-Za-z0-9_.-]{1,100}");} private static boolean safeGithubId(String x){return x!=null&&x.matches("[0-9]{1,20}");} private static boolean sameGithubId(String left,String right){try{return safeGithubId(left)&&safeGithubId(right)&&new BigInteger(left).equals(new BigInteger(right));}catch(NumberFormatException e){return false;}} private static boolean safeBranch(String x){return x!=null&&x.length()<=255&&!x.isBlank()&&!x.startsWith("-")&&!x.contains("..")&&!x.contains("@{")&&!x.chars().anyMatch(c->Character.isWhitespace(c)||c<32||"~^:?*[\\\\".indexOf(c)>=0);} private static boolean safePath(String x){if(x==null||x.length()>1024||x.startsWith("/")||x.contains("\\\\")||x.contains(".."))return false;return x.isBlank()||Arrays.stream(x.split("/",-1)).allMatch(s->safe(s)&&!s.equalsIgnoreCase(".git"));}
 @Override public Result createOnly(UserSettings s,Solution solution,FinalWriteGuard finalWriteGuard){
  if(appId.isBlank()||key.isBlank()||s.getGithubInstallationId()==null)return fallback.createOnly(s,solution);
  final String path; try { path=path(s,solution); } catch (IllegalArgumentException e) { return Result.failed("Unsafe Git path"); }
  boolean possibleWrite=false;
  try {
   String token=installationToken(s.getGithubInstallationId()); String repo=repo(s);
   Response ref=send("GET",repo+"/git/ref/heads/"+segment(s.getGithubBranch()),token,null); if(ref.code!=200)return classify(ref,false);
   String head=json.readTree(ref.body).path("object").path("sha").asText(); if(head.isBlank())return Result.unknown("Malformed branch reference");
   Response commit=send("GET",repo+"/git/commits/"+segment(head),token,null); if(commit.code!=200)return classify(commit,false);
   String tree=json.readTree(commit.body).path("tree").path("sha").asText(); if(tree.isBlank())return Result.unknown("Malformed commit");
   String targetPath=path;
   // GitHub otherwise checks the repository default branch. The ref is the
   // freshly observed target head, so create/update remains branch-correct.
   Response exists=send("GET",repo+"/contents/"+encodedPath(path)+"?ref="+segment(head),token,null);
   if(exists.code==200){
    ExistingFileState existing=existingFileState(exists,solution);if(existing==ExistingFileState.IDENTICAL)return Result.succeeded();if(existing==ExistingFileState.CONFLICT)return Result.failed("Git path is not an updatable file");
    targetPath=versionedPath(path,solution);
    Response versioned=send("GET",repo+"/contents/"+encodedPath(targetPath)+"?ref="+segment(head),token,null);
    if(versioned.code==200){ExistingFileState state=existingFileState(versioned,solution);if(state==ExistingFileState.IDENTICAL)return Result.succeeded();return Result.failed("Versioned Git path already exists");}else if(versioned.code!=404)return classify(versioned,false);
   }else if(exists.code!=404)return classify(exists,false);
   possibleWrite=true;
   Response blob=send("POST",repo+"/git/blobs",token,json.writeValueAsString(Map.of("content",Base64.getEncoder().encodeToString(solution.getSourceCode().getBytes(StandardCharsets.UTF_8)),"encoding","base64"))); if(blob.code!=201)return Result.unknown("Blob creation was not confirmed");
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
 private ExistingFileState existingFileState(Response response,Solution solution){
  try {
   JsonNode body=json.readTree(response.body); if(!"file".equals(body.path("type").asText())||!"base64".equals(body.path("encoding").asText()))return ExistingFileState.CONFLICT;
   String encoded=body.path("content").asText(); if(encoded.isBlank())return ExistingFileState.CONFLICT;
   byte[] remote=Base64.getMimeDecoder().decode(encoded); byte[] local=solution.getSourceCode().getBytes(StandardCharsets.UTF_8);
   return MessageDigest.isEqual(remote,local)?ExistingFileState.IDENTICAL:ExistingFileState.DIFFERENT;
  } catch(Exception ignored){return ExistingFileState.CONFLICT;}
 }
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
