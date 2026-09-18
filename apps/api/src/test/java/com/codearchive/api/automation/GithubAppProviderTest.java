package com.codearchive.api.automation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.settings.SettingsRequest;
import com.codearchive.api.settings.UserSettings;
import com.codearchive.api.solution.Platform;
import com.codearchive.api.solution.Solution;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.interfaces.RSAPrivateCrtKey;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class GithubAppProviderTest {
  private HttpServer server; private final List<Request> requests = new ArrayList<>();
  private int finalStatus = 200; private int installationListStatus = 200; private String installationListBody = "[]"; private boolean existing; private String existingBody = "{}"; private boolean versionedExisting; private String versionedExistingBody = "{}"; private boolean transientRef; private boolean dropFinal; private boolean movedBeforePatch; private boolean timeoutToken; private boolean timeoutBlob; private int refRequests;

  @BeforeEach void start() throws Exception { server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0); server.createContext("/",this::handle); server.start(); }
  @AfterEach void stop(){ if(server!=null)server.stop(0); }

  @Test void successUsesFreshHeadCreateOnlySequenceAndNonForceRef() throws Exception {
    GithubProvider.Result result=provider().createOnly(settings(),solution());
    assertThat(result.outcome()).isEqualTo(GithubProvider.Outcome.SUCCEEDED);
    assertThat(requests).extracting(Request::method,Request::path).containsExactly(
      org.assertj.core.groups.Tuple.tuple("POST","/app/installations/44/access_tokens"),
      org.assertj.core.groups.Tuple.tuple("GET","/repos/owner/repo/git/ref/heads/main"),
      org.assertj.core.groups.Tuple.tuple("GET","/repos/owner/repo/git/commits/head-sha"),
      org.assertj.core.groups.Tuple.tuple("GET","/repos/owner/repo/contents/SWEA/123-Title.java"),
      org.assertj.core.groups.Tuple.tuple("POST","/repos/owner/repo/git/blobs"),
      org.assertj.core.groups.Tuple.tuple("POST","/repos/owner/repo/git/trees"),
      org.assertj.core.groups.Tuple.tuple("POST","/repos/owner/repo/git/commits"),
      org.assertj.core.groups.Tuple.tuple("GET","/repos/owner/repo/git/ref/heads/main"),
      org.assertj.core.groups.Tuple.tuple("PATCH","/repos/owner/repo/git/refs/heads/main"));
    assertThat(requests.get(0).authorization()).startsWith("Bearer ").doesNotContain("private");
    assertThat(requests.get(4).body()).contains("Y2xhc3MgU29sdXRpb24ge30=");
    assertThat(requests.get(6).body()).contains("head-sha");
    assertThat(requests.get(6).body()).contains("\"message\":\"Add SWEA 123 solution\"");
    assertThat(requests.get(8).body()).contains("\"force\":false");
  }

  @Test void finalWriteGuardOrFreshHeadChangePreventsPatch() throws Exception {
    GithubProvider.Result denied=provider().createOnly(settings(),solution(),()->false);
    assertThat(denied.outcome()).isEqualTo(GithubProvider.Outcome.FAILED);
    assertThat(requests).extracting(Request::method).doesNotContain("PATCH");
    requests.clear(); refRequests=0; movedBeforePatch=true;
    GithubProvider.Result moved=provider().createOnly(settings(),solution());
    assertThat(moved.outcome()).isEqualTo(GithubProvider.Outcome.UNKNOWN);
    assertThat(requests).extracting(Request::method).doesNotContain("PATCH");
  }

  @Test void secondFinalWriteGuardCheckBlocksPatchAfterFreshHeadRead() throws Exception {
    AtomicInteger checks=new AtomicInteger();
    GithubProvider.Result result=provider().createOnly(settings(),solution(),()->checks.incrementAndGet()==1);
    assertThat(result.outcome()).isEqualTo(GithubProvider.Outcome.FAILED);
    assertThat(checks.get()).isEqualTo(2);
    assertThat(requests).extracting(Request::method).doesNotContain("PATCH");
    assertThat(requests).extracting(Request::path).contains("/repos/owner/repo/git/ref/heads/main");
  }

  @Test void requestTimeoutIsRetryableBeforeMutationAndUnknownAfterPossibleMutation() throws Exception {
    timeoutToken=true;
    assertThat(providerWithTimeout(100).createOnly(settings(),solution()).outcome()).isEqualTo(GithubProvider.Outcome.RETRYABLE);
    Thread.sleep(300); requests.clear(); timeoutToken=false; timeoutBlob=true;
    assertThat(providerWithTimeout(100).createOnly(settings(),solution()).outcome()).isEqualTo(GithubProvider.Outcome.UNKNOWN);
  }

  @Test void acceptsGithubStylePkcs1RsaPemAndUsesItToMintTheInstallationJwt() throws Exception {
    GithubProvider.Result result=provider(pkcs1Pem()).createOnly(settings(),solution());
    assertThat(result.outcome()).isEqualTo(GithubProvider.Outcome.SUCCEEDED);
    assertThat(requests.get(0).path()).isEqualTo("/app/installations/44/access_tokens");
    assertThat(requests.get(0).authorization()).startsWith("Bearer ").doesNotContain("BEGIN RSA");
  }

  @Test void existingNonFilePathFailsBeforeAnyMutation() throws Exception {
    existing=true; GithubProvider.Result result=provider().createOnly(settings(),solution());
    assertThat(result.outcome()).isEqualTo(GithubProvider.Outcome.FAILED);
    assertThat(requests).extracting(Request::path).noneMatch(path->path.contains("/git/blobs")||path.contains("/git/trees")||path.contains("/git/commits")&&path.endsWith("commit"));
    assertThat(requests).hasSize(4);
  }

  @Test void rendersAConfiguredSingleLineCommitMessage() throws Exception {
    GithubProvider.Result result=provider().createOnly(settings("main","Solve {platform} #{number}: {title} by {nickname}"),solution());
    assertThat(result.outcome()).isEqualTo(GithubProvider.Outcome.SUCCEEDED);
    assertThat(requests.get(6).body()).contains("\"message\":\"Solve SWEA #123: Title by n\"");
  }

  @Test void optionalGithubProblemHeaderIsWrittenWithMeasurements() throws Exception {
    Solution measured=new Solution(AppUser.fromGithub("1","owner","Owner",null),"33333333-3333-4333-8333-333333333333",Platform.SWEA,"123","Title","https://example.test/123","Java 21","class Solution {}","ACCEPTED",Instant.parse("2026-09-18T05:21:03.456Z"),Instant.parse("2026-09-18T05:21:03.456Z"),new BigDecimal("12.500000"),null);
    measured.setMemoryMeasurement(new BigDecimal("2048.000000"),"KB");

    GithubProvider.Result result=provider().createOnly(settings("main","Add {platform} {number} solution",true),measured);

    assertThat(result.outcome()).isEqualTo(GithubProvider.Outcome.SUCCEEDED);
    assertThat(blobSource()).isEqualTo("// SWEA #123 · Title\n// https://example.test/123\n// Language: Java 21\n// Execution Time: 12.5 ms\n// Memory: 2048 KB\n\nclass Solution {}");
  }

  @Test void githubProblemHeaderPreservesPythonShebangAndIsUsedForIdempotency() throws Exception {
    Solution python=new Solution(AppUser.fromGithub("1","owner","Owner",null),"44444444-4444-4444-8444-444444444444",Platform.SWEA,"123","Title","https://example.test/123","Python3","#!/usr/bin/python\nprint(1)","ACCEPTED",Instant.parse("2026-09-18T05:21:03.456Z"),Instant.parse("2026-09-18T05:21:03.456Z"),null,null);
    UserSettings configured=settings("main","Add {platform} {number} solution",true);
    assertThat(provider().createOnly(configured,python).outcome()).isEqualTo(GithubProvider.Outcome.SUCCEEDED);
    String rendered=blobSource();
    assertThat(rendered).isEqualTo("#!/usr/bin/python\n# SWEA #123 · Title\n# https://example.test/123\n# Language: Python3\n\nprint(1)");
    requests.clear();refRequests=0;existing=true;existingBody=fileBody(rendered);

    GithubProvider.Result result=provider().createOnly(configured,python);

    assertThat(result.outcome()).isEqualTo(GithubProvider.Outcome.SUCCEEDED);
    assertThat(requests).hasSize(4);
    assertThat(requests).extracting(Request::path).noneMatch(path->path.contains("/git/blobs")||path.contains("/git/trees")||path.endsWith("/git/commits"));
  }

  @Test void existingPathWithDifferentContentCreatesANewTimestampedFile() throws Exception {
    existing=true;
    existingBody="{\"type\":\"file\",\"encoding\":\"base64\",\"content\":\""+Base64.getMimeEncoder().encodeToString("class OldSolution {}".getBytes(StandardCharsets.UTF_8))+"\"}";
    GithubProvider.Result result=provider().createOnly(settings(),solution());
    assertThat(result.outcome()).isEqualTo(GithubProvider.Outcome.SUCCEEDED);
    assertThat(requests).extracting(Request::method,Request::path).contains(
      org.assertj.core.groups.Tuple.tuple("GET","/repos/owner/repo/contents/SWEA/123-Title_20260918-052103456_11111111.java"),
      org.assertj.core.groups.Tuple.tuple("POST","/repos/owner/repo/git/commits"),
      org.assertj.core.groups.Tuple.tuple("PATCH","/repos/owner/repo/git/refs/heads/main"));
    assertThat(requests).filteredOn(request->request.path().endsWith("/git/trees")).singleElement().extracting(Request::body)
      .asString().contains("\"path\":\"SWEA/123-Title_20260918-052103456_11111111.java\"");
    assertThat(requests.get(requests.size()-1).body()).contains("\"force\":false");
  }

  @Test void retryOfTimestampedFileWithIdenticalContentIsIdempotent() throws Exception {
    existing=true; versionedExisting=true;
    existingBody=fileBody("class OldSolution {}"); versionedExistingBody=fileBody("class Solution {}");

    GithubProvider.Result result=provider().createOnly(settings(),solution());

    assertThat(result.outcome()).isEqualTo(GithubProvider.Outcome.SUCCEEDED);
    assertThat(requests).hasSize(5);
    assertThat(requests).extracting(Request::path).noneMatch(path->path.contains("/git/blobs")||path.contains("/git/trees")||path.endsWith("/git/commits"));
  }

  @Test void neverOverwritesAConflictingTimestampedFile() throws Exception {
    existing=true; versionedExisting=true;
    existingBody=fileBody("class OldSolution {}"); versionedExistingBody=fileBody("class OtherSolution {}");

    GithubProvider.Result result=provider().createOnly(settings(),solution());

    assertThat(result.outcome()).isEqualTo(GithubProvider.Outcome.FAILED);
    assertThat(requests).extracting(Request::path).noneMatch(path->path.contains("/git/blobs")||path.contains("/git/trees")||path.endsWith("/git/commits"));
  }

  @Test void timestampSuffixPreservesCustomPathAndLanguageExtension() throws Exception {
    existing=true; existingBody=fileBody("print('old')");
    Solution python=new Solution(AppUser.fromGithub("1","owner","Owner",null),"22222222-2222-4222-8222-222222222222",Platform.SWEA,"123","Title","https://example.test/123","Python3","print('new')","ACCEPTED",Instant.parse("2026-09-18T05:21:03.456Z"),Instant.parse("2026-09-18T05:21:03.456Z"),null,null);

    GithubProvider.Result result=provider().createOnly(settingsWithPath("solutions/{language}/{number}"),python);

    assertThat(result.outcome()).isEqualTo(GithubProvider.Outcome.SUCCEEDED);
    assertThat(requests).filteredOn(request->request.path().endsWith("/git/trees")).singleElement().extracting(Request::body)
      .asString().contains("\"path\":\"solutions/Python3/123_20260918-052103456_22222222.py\"");
  }

  @Test void rendersTimeAndCaptureIdPathTokens() throws Exception {
    GithubProvider.Result result=provider().createOnly(settingsWithPath("{platform}/{number}_{title}/{time}_{capture_ID}"),solution());
    assertThat(result.outcome()).isEqualTo(GithubProvider.Outcome.SUCCEEDED);
    assertThat(requests.get(3).path()).isEqualTo("/repos/owner/repo/contents/SWEA/123_Title/260918052103_11111111-1111-4111-8111-111111111111.java");
  }

  @Test void existingPathWithIdenticalContentIsAnIdempotentSuccess() throws Exception {
    existing=true;
    existingBody="{\"type\":\"file\",\"encoding\":\"base64\",\"content\":\""+Base64.getMimeEncoder().encodeToString("class Solution {}".getBytes(StandardCharsets.UTF_8))+"\"}";
    GithubProvider.Result result=provider().createOnly(settings(),solution());
    assertThat(result.outcome()).isEqualTo(GithubProvider.Outcome.SUCCEEDED);
    assertThat(requests).hasSize(4);
    assertThat(requests).extracting(Request::path).noneMatch(path->path.contains("/git/blobs")||path.contains("/git/trees")||path.endsWith("/git/commits"));
  }

  @Test void preWriteTransientIsRetryable() throws Exception {
    transientRef=true; GithubProvider.Result result=provider().createOnly(settings(),solution());
    assertThat(result.outcome()).isEqualTo(GithubProvider.Outcome.RETRYABLE);
    assertThat(requests).hasSize(2);
  }

  @Test void finalConflictOrLostReplyIsUnknownAndNeverRetryable() throws Exception {
    finalStatus=409; assertThat(provider().createOnly(settings(),solution()).outcome()).isEqualTo(GithubProvider.Outcome.UNKNOWN);
    requests.clear(); finalStatus=200; dropFinal=true;
    assertThat(provider().createOnly(settings(),solution()).outcome()).isEqualTo(GithubProvider.Outcome.UNKNOWN);
  }

  @Test void encodesSlashBranchAndUnicodeOrSpaceContentPathWhileCheckingFreshHead() throws Exception {
    UserSettings configured=settings("release/한글 feature");
    Solution titled=new Solution(AppUser.fromGithub("1","owner","Owner",null),"11111111-1111-4111-8111-111111111111",Platform.SWEA,"123","한 글 space","https://example.test/123","Python3","print(1)","ACCEPTED",Instant.now(),Instant.now(),null,null);
    assertThat(provider().createOnly(configured,titled).outcome()).isEqualTo(GithubProvider.Outcome.SUCCEEDED);
    assertThat(requests.get(1).rawPath()).endsWith("/git/ref/heads/release%2F%ED%95%9C%EA%B8%80%20feature");
    Request lookup=requests.get(3);
    assertThat(lookup.rawPath()).contains("/contents/SWEA/123-%ED%95%9C%20%EA%B8%80%20space.py");
    assertThat(lookup.query()).isEqualTo("ref=head-sha");
  }

  @Test void installationBrowseClassifiesRateLimitAndServerErrorsAsProviderOutages() throws Exception {
    for(int status:List.of(429,503)){
      installationListStatus=status;
      assertThatThrownBy(()->provider().installations("1"))
        .isInstanceOf(GithubAppProvider.ProviderUnavailableException.class)
        .isNotInstanceOf(SecurityException.class);
      requests.clear();
    }
  }

  @Test void installationBrowseClassifiesAuthenticationAndMalformedResponsesAsProviderOutages() throws Exception {
    installationListStatus=403;
    assertThatThrownBy(()->provider().installations("1"))
      .isInstanceOf(GithubAppProvider.ProviderUnavailableException.class);
    requests.clear(); installationListStatus=200; installationListBody="{}";
    assertThatThrownBy(()->provider().installations("1"))
      .isInstanceOf(GithubAppProvider.ProviderUnavailableException.class);
  }

  @Test void installationBrowseRejectsMalformedArrayEntriesAndAcceptsACompletePersonalInstallation() throws Exception {
    for(String malformed:List.of("[{}]","[{\"id\":44,\"account\":{\"id\":1,\"type\":\"User\"}}]","[{\"id\":44,\"account\":{\"id\":1,\"login\":\"owner\",\"type\":\"User\"}}]")){
      installationListBody=malformed;
      assertThatThrownBy(()->provider().installations("1"))
        .isInstanceOf(GithubAppProvider.ProviderUnavailableException.class);
      requests.clear();
    }
    installationListBody="[{\"id\":44,\"account\":{\"id\":1,\"login\":\"owner\",\"type\":\"User\"},\"suspended_at\":null}]";
    assertThat(provider().installations("1"))
      .containsExactly(new GithubAppProvider.InstallationChoice(44L,"owner"));
  }

  private GithubAppProvider provider() throws Exception { return provider(pem()); }
  private GithubAppProvider provider(String privateKey) { return new GithubAppProvider("99",privateKey,"http://127.0.0.1:"+server.getAddress().getPort(),HttpClient.newHttpClient(),new ObjectMapper()); }
  private GithubAppProvider providerWithTimeout(long timeoutMs) throws Exception { return new GithubAppProvider("99",pem(),"http://127.0.0.1:"+server.getAddress().getPort(),HttpClient.newHttpClient(),new ObjectMapper(),timeoutMs); }
  private UserSettings settings(){ return settings("main"); }
  private UserSettings settings(String branch){ return settings(branch,"Add {platform} {number} solution"); }
  private UserSettings settings(String branch,String commitMessage){ return settings(branch,commitMessage,false); }
  private UserSettings settings(String branch,String commitMessage,boolean githubHeader){ UserSettings s=new UserSettings(AppUser.fromGithub("1","owner","Owner",null)); s.apply(new SettingsRequest(0,"n","n",false,false,githubHeader,"{number}","{platform}/{number}-{title}",commitMessage,"github-light","github-dark",true,true,44L,"owner","repo",branch,null)); return s; }
  private UserSettings settingsWithPath(String path){ UserSettings s=new UserSettings(AppUser.fromGithub("1","owner","Owner",null)); s.apply(new SettingsRequest(0,"n","n",false,false,false,"{number}",path,"Add {platform} {number} solution","github-light","github-dark",true,true,44L,"owner","repo","main",null)); return s; }
  private Solution solution(){ Instant solved=Instant.parse("2026-09-18T05:21:03.456Z");return new Solution(AppUser.fromGithub("1","owner","Owner",null),"11111111-1111-4111-8111-111111111111",Platform.SWEA,"123","Title","https://example.test/123","Java 21","class Solution {}","ACCEPTED",solved,solved,null,null); }
  private String fileBody(String source){return "{\"type\":\"file\",\"encoding\":\"base64\",\"content\":\""+Base64.getEncoder().encodeToString(source.getBytes(StandardCharsets.UTF_8))+"\"}";}
  private String blobSource() throws Exception { Request blob=requests.stream().filter(request->request.path().endsWith("/git/blobs")).findFirst().orElseThrow();String encoded=new ObjectMapper().readTree(blob.body()).path("content").asText();return new String(Base64.getDecoder().decode(encoded),StandardCharsets.UTF_8); }
  private String pem() throws Exception { KeyPairGenerator g=KeyPairGenerator.getInstance("RSA"); g.initialize(2048); PrivateKey key=g.generateKeyPair().getPrivate(); return "-----BEGIN PRIVATE KEY-----\n"+Base64.getMimeEncoder(64,new byte[]{'\n'}).encodeToString(key.getEncoded())+"\n-----END PRIVATE KEY-----"; }
  /** Same ASN.1 form GitHub's \"BEGIN RSA PRIVATE KEY\" downloads use. */
  private String pkcs1Pem() throws Exception {
    KeyPairGenerator generator=KeyPairGenerator.getInstance("RSA"); generator.initialize(2048);
    RSAPrivateCrtKey rsa=(RSAPrivateCrtKey)generator.generateKeyPair().getPrivate();
    byte[] der=sequence(integer(BigInteger.ZERO),integer(rsa.getModulus()),integer(rsa.getPublicExponent()),integer(rsa.getPrivateExponent()),integer(rsa.getPrimeP()),integer(rsa.getPrimeQ()),integer(rsa.getPrimeExponentP()),integer(rsa.getPrimeExponentQ()),integer(rsa.getCrtCoefficient()));
    return "-----BEGIN RSA PRIVATE KEY-----\n"+Base64.getMimeEncoder(64,new byte[]{'\n'}).encodeToString(der)+"\n-----END RSA PRIVATE KEY-----";
  }
  private static byte[] sequence(byte[]... fields) { return tagged(0x30,join(fields)); }
  private static byte[] integer(BigInteger value) { return tagged(0x02,value.toByteArray()); }
  private static byte[] tagged(int tag,byte[] body) { byte[] length=length(body.length); byte[] result=new byte[1+length.length+body.length]; result[0]=(byte)tag;System.arraycopy(length,0,result,1,length.length);System.arraycopy(body,0,result,1+length.length,body.length);return result; }
  private static byte[] length(int value) { if(value<128)return new byte[]{(byte)value}; int count=0;for(int n=value;n>0;n>>>=8)count++;byte[] result=new byte[count+1];result[0]=(byte)(0x80|count);for(int i=count;i>0;i--){result[i]=(byte)value;value>>>=8;}return result; }
  private static byte[] join(byte[]... values) { int size=0;for(byte[] value:values)size+=value.length;byte[] result=new byte[size];int offset=0;for(byte[] value:values){System.arraycopy(value,0,result,offset,value.length);offset+=value.length;}return result; }
  private void handle(HttpExchange x) throws IOException { String body=new String(x.getRequestBody().readAllBytes(),StandardCharsets.UTF_8); requests.add(new Request(x.getRequestMethod(),x.getRequestURI().getPath(),x.getRequestURI().getRawPath(),x.getRequestURI().getRawQuery(),x.getRequestHeaders().getFirst("Authorization"),body)); String path=x.getRequestURI().getPath(); if(dropFinal&&path.contains("/git/refs/")){x.close();return;} if(path.equals("/app/installations"))reply(x,installationListStatus,installationListBody); else if(path.endsWith("/access_tokens")){pauseIf(timeoutToken);reply(x,201,"{\"token\":\"installation-token\"}");} else if(path.contains("/git/ref/")){refRequests++;reply(x,transientRef?503:200,"{\"object\":{\"sha\":\""+(movedBeforePatch&&refRequests>1?"moved-head":"head-sha")+"\"}}");} else if(path.contains("/git/commits/head-sha"))reply(x,200,"{\"tree\":{\"sha\":\"tree-sha\"}}"); else if(path.contains("/contents/")){boolean versioned=path.matches(".*_\\d{8}-\\d{9}_[A-Za-z0-9]{8}\\.[A-Za-z0-9]+$");reply(x,versioned?(versionedExisting?200:404):(existing?200:404),versioned?(versionedExisting?versionedExistingBody:"{}"): (existing?existingBody:"{}"));} else if(path.endsWith("/git/blobs")){pauseIf(timeoutBlob);reply(x,201,"{\"sha\":\"blob-sha\"}");} else if(path.endsWith("/git/trees"))reply(x,201,"{\"sha\":\"new-tree\"}"); else if(path.endsWith("/git/commits"))reply(x,201,"{\"sha\":\"new-commit\"}"); else if(path.contains("/git/refs/"))reply(x,finalStatus,"{}"); else reply(x,500,"{}"); }
  private static void pauseIf(boolean delayed) { if(!delayed)return;try{Thread.sleep(250);}catch(InterruptedException e){Thread.currentThread().interrupt();} }
  private void reply(HttpExchange x,int status,String body)throws IOException{x.sendResponseHeaders(status,body.getBytes(StandardCharsets.UTF_8).length);x.getResponseBody().write(body.getBytes(StandardCharsets.UTF_8));x.close();}
  private record Request(String method,String path,String rawPath,String query,String authorization,String body){}
}
