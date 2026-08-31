package com.codearchive.api.integration.github;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockCookie;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;
import com.codearchive.api.auth.oauth.GitHubUserProfile;
import com.codearchive.api.auth.security.*;
import com.codearchive.api.auth.session.*;
import com.codearchive.api.auth.user.*;
import com.codearchive.api.solution.SolutionRepository;
import com.codearchive.api.common.exception.*;
import com.fasterxml.jackson.databind.ObjectMapper;

@SpringBootTest(properties = {"DB_PASSWORD=test-only", "codearchive.auth.dashboard-origin=https://codearchive-dashboard-beta.onrender.com",
        "codearchive.integrations.github.enabled=true", "codearchive.integrations.github.contents-read-enabled=true",
        "codearchive.integrations.github.contents-write-enabled=true"})
@AutoConfigureMockMvc @Testcontainers @ExtendWith(OutputCaptureExtension.class)
class GitHubAutoCommitIntegrationTest {
    private static final String BASE = "/api/v1/integrations/github/auto-commit";
    private static final String HEAD = "a".repeat(40), ROOT = "b".repeat(40), COMMIT = "c".repeat(40);
    private static final String CODE = "// synthetic-commit-source 한글\r\nclass Main {}\r\n";
    private static final GitHubUploadCommitService.Consent CONSENT = new GitHubUploadCommitService.Consent(true, true, true);
    @Container @ServiceConnection static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:17-alpine");
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired UserRepository users;
    @Autowired AuthSessionRepository sessions;
    @Autowired SecureTokenCodec tokens;
    @Autowired SolutionRepository solutions;
    @Autowired JdbcTemplate db;
    @Autowired GitHubAutoCommitService service;
    @Autowired GitHubCommitExecutor executor;
    @Autowired GitHubAppProperties properties;
    
    @MockitoBean GitHubAppClient github;
    GitHubAppClient.PreparedCommit prepared;
    record Actor(UUID id, UUID session, long githubId, String login, String token) {
        CodeArchivePrincipal principal() { return new CodeArchivePrincipal(id, session, login); }
    }
    @BeforeEach void enableMockOnlyGate() { properties.setContentsWriteEnabled(true); prepared = mock(GitHubAppClient.PreparedCommit.class); }
    @AfterEach void clean() { db.update("DELETE FROM users"); }

    private GitHubAutoCommitService.Enable enableRequest(Actor a, boolean privateRepo) {
        return new GitHubAutoCommitService.Enable(new GitHubAutoCommitStore.Target(701,801,"main",HEAD,"archive",privateRepo,a.login()+"/solutions"),true,true,true);
    }
    private UUID enable(Actor a) { UUID run=UUID.randomUUID(); service.enable(a.principal(),run,enableRequest(a,true)); return run; }

    @Test void defaultsOffAndProviderGateAndAutomaticConsentAreIndependent() {
        var a=actor(); var request=enableRequest(a,true);
        assertThat(service.status(a.principal(),null).state()).isEqualTo("OFF");
        properties.setContentsWriteEnabled(false);
        error(()->service.enable(a.principal(),UUID.randomUUID(),request),ErrorCode.GITHUB_INTEGRATION_UNAVAILABLE);
        properties.setContentsWriteEnabled(true);
        for (var consent:List.of(new GitHubAutoCommitService.Enable(request.target(),false,true,true),new GitHubAutoCommitService.Enable(request.target(),true,false,true)))
            error(()->service.enable(a.principal(),UUID.randomUUID(),consent),ErrorCode.GITHUB_UPLOAD_CONSENT_REQUIRED);
        verifyNoInteractions(github,prepared);
        assertThat(db.queryForObject("SELECT count(*) FROM github_auto_runs",Integer.class)).isZero();
    }

    @Test void onlyNewAcceptedCapturesAreSentOnceAndArchiveRemainsUnchanged(CapturedOutput output) throws Exception {
        var a=actor(); allow(a,true); UUID old=capture(a); UUID run=enable(a);
        assertThat(service.tick(a.principal(),run).lastResult()).isNull();
        UUID lateOld=capture(a);
        db.update("UPDATE solutions SET observed_at=clock_timestamp()-interval '1 day' WHERE id=?",lateOld);
        UUID manual=capture(a); db.update("UPDATE solutions SET accepted_capture=false WHERE id=?",manual);
        var other=actor(); capture(other);
        UUID fresh=capture(a); var before=db.queryForMap("SELECT * FROM solutions WHERE id=?",fresh);
        var result=service.tick(a.principal(),run);
        assertThat(result.lastResult().status()).isEqualTo("SUCCEEDED");
        assertThat(result.target().expectedCommitSha()).isEqualTo(COMMIT);
        service.tick(a.principal(),run);
        verify(prepared,times(1)).create(CODE,"Add SWEA 1206 solution");
        verify(github).prepareCommit(argThat(t->t.path().equals("archive/SWEA/1206/Solution.java")&&t.expectedCommitSha().equals(HEAD)));
        assertThat(db.queryForMap("SELECT * FROM solutions WHERE id=?",fresh)).isEqualTo(before);
        assertThat(db.queryForList("SELECT solution_id FROM github_auto_attempts",UUID.class)).containsExactly(fresh).doesNotContain(old,lateOld,manual);
        assertThat(db.queryForObject("SELECT count(*) FROM github_upload_intents",Integer.class)).isZero();
        assertThat(output).doesNotContain("synthetic-commit-source",a.token());
    }

    @Test void temporaryCapacityLimitDoesNotClaimAnAutomaticSource() throws Exception {
        var a=actor();allow(a,true);UUID run=enable(a);capture(a);
        assertThat(executor.reserve()).isTrue();assertThat(executor.reserve()).isTrue();
        try {
            error(()->service.tick(a.principal(),run),ErrorCode.RATE_LIMITED);
            assertThat(db.queryForObject("SELECT count(*) FROM github_auto_attempts",Integer.class)).isZero();
            assertThat(service.status(a.principal(),run).state()).isEqualTo("ACTIVE");
            verifyNoInteractions(prepared);
        } finally { executor.release();executor.release(); }
    }

    @Test void stopBeforeEnableAndStopDuringEnableCannotBeUndoneByLateResponses() {
        var a=actor(); allow(a,true); UUID run=UUID.randomUUID();
        service.stop(a.principal(),run);
        assertThat(service.enable(a.principal(),run,enableRequest(a,true)).state()).isEqualTo("OFF");
        verifyNoInteractions(github);
        UUID late=UUID.randomUUID();
        when(github.inspectUploadTarget(anyLong(),anyLong(),anyLong(),anyString(),anyString(),anyString())).thenAnswer(call->{
            service.stop(a.principal(),late);
            var owner=new GitHubAppClient.Account(a.githubId(),a.login(),"User");
            return new GitHubAppClient.UploadTarget(new GitHubAppClient.Repository(801,owner,"solutions",true,"main"),"main",HEAD,ROOT,false,List.of(),null,null);
        });
        error(()->service.enable(a.principal(),late,enableRequest(a,true)),ErrorCode.GITHUB_AUTO_STOPPED);
        assertThat(service.status(a.principal(),late).state()).isEqualTo("OFF");
    }

    @Test void publicConsentAndRenamedOrChangedVisibilityFailClosed() {
        var a=actor();allow(a,false);
        var publicRequest=enableRequest(a,false);
        error(()->service.enable(a.principal(),UUID.randomUUID(),new GitHubAutoCommitService.Enable(publicRequest.target(),true,true,false)),ErrorCode.GITHUB_UPLOAD_CONSENT_REQUIRED);
        error(()->service.enable(a.principal(),UUID.randomUUID(),enableRequest(a,true)),ErrorCode.GITHUB_UPLOAD_TARGET_CHANGED);
        assertThat(service.enable(a.principal(),UUID.randomUUID(),publicRequest).state()).isEqualTo("ACTIVE");
        verifyNoInteractions(prepared);
    }

    @Test void accountAndSessionIsolationAndLeaseExpiryNeverResume() throws Exception {
        var a=actor();var b=actor();allow(a,true);UUID run=enable(a);capture(a);
        error(()->service.tick(b.principal(),run),ErrorCode.GITHUB_AUTO_STOPPED);
        error(()->service.stop(b.principal(),run),ErrorCode.GITHUB_AUTO_STOPPED);
        var session=sessions.save(AuthSession.create(a.id(),tokens.hash(UUID.randomUUID().toString()),Instant.now().plusSeconds(3600),Instant.now()));
        var another=new CodeArchivePrincipal(a.id(),session.getId(),a.login());
        error(()->service.tick(another,run),ErrorCode.GITHUB_AUTO_STOPPED);
        error(()->enable(a),ErrorCode.GITHUB_AUTO_ACTIVE);
        db.update("UPDATE github_auto_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=?",run);
        assertThat(service.status(a.principal(),run).state()).isEqualTo("OFF");
        error(()->service.tick(a.principal(),run),ErrorCode.GITHUB_AUTO_STOPPED);
        assertThat(service.enable(a.principal(),run,enableRequest(a,true)).state()).isEqualTo("OFF");
        verifyNoInteractions(prepared);
    }

    @ParameterizedTest @ValueSource(strings={"off","logout","expiry","edit","delete","permission","head","privacy"})
    void changesDuringPreflightPreventSourceTransmission(String change) throws Exception {
        var a=actor();allow(a,true);UUID run=enable(a);UUID source=capture(a);
        when(github.prepareCommit(any())).thenAnswer(call->{
            switch(change) {
                case "off" -> service.stop(a.principal(),run);
                case "logout" -> sessions.revoke(a.session(),Instant.now());
                case "expiry" -> db.update("UPDATE github_auto_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=?",run);
                case "edit" -> db.update("UPDATE solutions SET code='edited' WHERE id=?",source);
                case "delete" -> db.update("DELETE FROM solutions WHERE id=?",source);
                case "permission" -> throw new CodeArchiveException(ErrorCode.ACCESS_DENIED);
                default -> throw new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_TARGET_CHANGED);
            }
            return prepared;
        });
        assertThatThrownBy(()->service.tick(a.principal(),run)).isInstanceOf(CodeArchiveException.class);
        verifyNoInteractions(prepared);
        assertThat(db.queryForObject("SELECT state FROM github_auto_attempts WHERE run_id=?",String.class,run)).isEqualTo("REJECTED");
        assertThat(db.queryForObject("SELECT state FROM github_auto_runs WHERE id=?",String.class,run)).isIn("OFF","PAUSED");
    }

    @Test void simultaneousTicksDoNotDuplicateAndCompletedOffForbidsLaterSends() throws Exception {
        var a=actor();allow(a,true);UUID run=enable(a);capture(a);
        var entered=new CountDownLatch(1);var proceed=new CountDownLatch(1);
        when(github.prepareCommit(any())).thenAnswer(call->{entered.countDown();assertThat(proceed.await(10,TimeUnit.SECONDS)).isTrue();return prepared;});
        var executor=Executors.newSingleThreadExecutor();
        try {
            var first=executor.submit(()->service.tick(a.principal(),run));
            assertThat(entered.await(10,TimeUnit.SECONDS)).isTrue();
            assertThat(service.tick(a.principal(),run).lastResult().status()).isEqualTo("UNKNOWN");
            assertThat(service.stop(a.principal(),run).state()).isEqualTo("OFF");
            proceed.countDown();
            assertThatThrownBy(()->first.get(10,TimeUnit.SECONDS)).hasCauseInstanceOf(CodeArchiveException.class);
            error(()->service.tick(a.principal(),run),ErrorCode.GITHUB_AUTO_STOPPED);
            verifyNoInteractions(prepared);
        } finally { proceed.countDown();executor.shutdownNow(); }
    }

    @Test void unknownOrCrashTombstoneBlocksAutomaticRetriesEvenWithNewConsent(CapturedOutput output) throws Exception {
        var a=actor();allow(a,true);UUID run=enable(a);capture(a);
        when(prepared.create(anyString(),anyString())).thenThrow(new IllegalStateException("auto-provider-canary"));
        error(()->service.tick(a.principal(),run),ErrorCode.GITHUB_UPLOAD_OUTCOME_UNKNOWN);
        assertThat(service.status(a.principal(),run).state()).isEqualTo("PAUSED");
        service.stop(a.principal(),run);
        error(()->enable(a),ErrorCode.GITHUB_UPLOAD_OUTCOME_UNKNOWN);
        db.update("UPDATE github_auto_attempts SET state='ATTEMPTED' WHERE run_id=?",run);
        error(()->enable(a),ErrorCode.GITHUB_UPLOAD_OUTCOME_UNKNOWN);
        verify(prepared,times(1)).create(anyString(),anyString());
        assertThat(output).doesNotContain("auto-provider-canary",CODE);
    }

    @Test void controllerIsPrivateNoStoreAndCrossOriginCookieWritesAreDenied() throws Exception {
        var a=actor();allow(a,true);UUID run=UUID.randomUUID();
        mvc.perform(get(BASE)).andExpect(status().isUnauthorized());
        mvc.perform(post(BASE+"/{id}/enable",run).header("Authorization","Bearer "+a.token()).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(enableRequest(a,true))))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store, private"))
                .andExpect(jsonPath("$.data.target.repositoryId").value("801")).andExpect(jsonPath("$.data.state").value("ACTIVE"));
        mvc.perform(post(BASE+"/{id}/tick",run).cookie(new MockCookie(ApiAuthenticationFilter.SESSION_COOKIE_NAME,a.token())).header("Origin","https://evil.example"))
                .andExpect(status().isForbidden());
        mvc.perform(post(BASE+"/{id}/stop",run).header("Authorization","Bearer "+a.token())).andExpect(status().isOk()).andExpect(jsonPath("$.data.state").value("OFF"));
    }

    private Actor actor() {
        Instant now = Instant.now(); long githubId = UUID.randomUUID().getMostSignificantBits() & Long.MAX_VALUE;
        String login = "u" + githubId;
        var user = users.save(CodeArchiveUser.create(new GitHubUserProfile(githubId, login, "Synthetic", null), now));
        String token = UUID.randomUUID().toString();
        var session = sessions.save(AuthSession.create(user.getId(), tokens.hash(token), now.plusSeconds(3600), now));
        return new Actor(user.getId(), session.getId(), githubId, login, token);
    }
    private UUID capture(Actor a) throws Exception {
        String client = UUID.randomUUID().toString(); var p = new HashMap<String, Object>();
        p.put("clientRecordId", client); p.put("platform", "SWEA"); p.put("problemNumber", "1206");
        p.put("title", "Synthetic"); p.put("language", "Java"); p.put("code", CODE); p.put("result", "ACCEPTED");
        p.put("solvedAt", "2026-08-30T01:00:00Z"); p.put("observedAt", Instant.now().toString()); p.put("aiUsage", "unknown");
        mvc.perform(post("/api/v1/solutions/bulk-upsert").header("Authorization", "Bearer " + a.token()).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("records", List.of(p))))).andExpect(status().isOk());
        return solutions.findByUserIdAndClientRecordId(a.id(), client).orElseThrow().getId();
    }
    private GitHubAppClient.CommitResult committed(Actor a) { return new GitHubAppClient.CommitResult(COMMIT, "https://github.com/" + a.login() + "/solutions/commit/" + COMMIT); }
    private void allow(Actor a, boolean privateRepo) {
        var owner = new GitHubAppClient.Account(a.githubId(), a.login(), "User");
        when(github.findPersonalInstallation(a.login())).thenReturn(Optional.of(new GitHubAppClient.Installation(701, owner, "selected", false)));
        when(github.inspectUploadTarget(anyLong(), anyLong(), anyLong(), anyString(), anyString(), anyString()))
                .thenReturn(new GitHubAppClient.UploadTarget(new GitHubAppClient.Repository(801, owner, "solutions", privateRepo, "main"), "main", HEAD, ROOT, false, List.of(), null, null));
        when(github.prepareCommit(any())).thenReturn(prepared);
        when(prepared.create(anyString(), anyString())).thenReturn(committed(a));
    }
    private void error(Runnable action, ErrorCode expected) {
        assertThatThrownBy(action::run).isInstanceOf(CodeArchiveException.class).satisfies(failure -> {
            assertThat(((CodeArchiveException) failure).getErrorCode()).isEqualTo(expected);
            assertThat(failure.getCause()).isNull();
            assertThat(failure.getMessage()).doesNotContain("canary", "synthetic-commit-source");
        });
    }
}
