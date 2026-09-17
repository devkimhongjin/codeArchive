package com.codearchive.api.automation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import com.codearchive.api.auth.AppUser;
import com.codearchive.api.settings.SettingsRequest;
import com.codearchive.api.settings.UserSettings;
import com.codearchive.api.settings.UserSettingsRepository;
import com.codearchive.api.solution.Platform;
import com.codearchive.api.solution.Solution;
import com.codearchive.api.solution.SolutionRepository;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class GithubAutomationServiceTest {
  @Test void boundaryDeduplicationAndRestartClaimAreDurable() throws Exception {
    GithubCommitJobRepository jobs=mock(GithubCommitJobRepository.class); UserSettingsRepository settingsRepo=mock(UserSettingsRepository.class); SolutionRepository solutions=mock(SolutionRepository.class); GithubProvider provider=mock(GithubProvider.class);
    AppUser user=AppUser.fromGithub("1","owner","Owner",null); set(user,"id",1L); UserSettings settings=settings(user,5,Instant.parse("2026-01-01T00:00:00Z"));
    Solution before=solution(user,"before",Instant.parse("2025-12-31T23:59:59Z")), equal=solution(user,"equal",Instant.parse("2026-01-01T00:00:00Z"));
    when(settingsRepo.findByUserId(1L)).thenReturn(Optional.of(settings)); when(jobs.findByUserIdAndCaptureId(1L,"before")).thenReturn(Optional.empty()); when(jobs.findByUserIdAndCaptureId(1L,"equal")).thenReturn(Optional.empty());
    GithubAutomationService first=new GithubAutomationService(jobs,settingsRepo,solutions,provider);
    first.consider(user,before); verify(jobs,never()).save(any());
    first.consider(user,equal); verify(jobs).save(any(GithubCommitJob.class));
    GithubCommitJob pending=new GithubCommitJob(user,"equal",5); set(pending,"id",9L);
    // A new service instance is the worker-restart simulation: persisted PENDING
    // is claimed exactly once and succeeds.
    when(jobs.findByIdForClaim(9L)).thenReturn(Optional.of(pending)); when(jobs.findById(9L)).thenReturn(Optional.of(pending)); when(solutions.findByUserIdAndCaptureId(1L,"equal")).thenReturn(Optional.of(equal)); when(provider.createOnly(eq(settings),eq(equal),any())).thenReturn(GithubProvider.Result.succeeded());
    new GithubAutomationService(jobs,settingsRepo,solutions,provider).process(9L);
    assertThat(pending.getState()).isEqualTo(CommitJobState.SUCCEEDED); verify(provider).createOnly(eq(settings),eq(equal),any());
  }

  @Test void staleGenerationFailsBeforeProviderAndRetryUnknownStatesAreTerminal() throws Exception {
    GithubCommitJobRepository jobs=mock(GithubCommitJobRepository.class); UserSettingsRepository settingsRepo=mock(UserSettingsRepository.class); SolutionRepository solutions=mock(SolutionRepository.class); GithubProvider provider=mock(GithubProvider.class);
    AppUser user=AppUser.fromGithub("1","owner","Owner",null); set(user,"id",1L); UserSettings current=settings(user,7,Instant.EPOCH); Solution capture=solution(user,"capture",Instant.now());
    GithubAutomationService service=new GithubAutomationService(jobs,settingsRepo,solutions,provider);
    GithubCommitJob stale=new GithubCommitJob(user,"capture",6); set(stale,"id",1L); when(jobs.findByIdForClaim(1L)).thenReturn(Optional.of(stale)); when(jobs.findById(1L)).thenReturn(Optional.of(stale)); when(settingsRepo.findByUserId(1L)).thenReturn(Optional.of(current)); when(solutions.findByUserIdAndCaptureId(1L,"capture")).thenReturn(Optional.of(capture));
    service.process(1L); assertThat(stale.getState()).isEqualTo(CommitJobState.FAILED); verifyNoInteractions(provider);
    GithubCommitJob retry=new GithubCommitJob(user,"capture",7); set(retry,"id",2L); when(jobs.findByIdForClaim(2L)).thenReturn(Optional.of(retry)); when(jobs.findById(2L)).thenReturn(Optional.of(retry)); when(provider.createOnly(eq(current),eq(capture),any())).thenReturn(GithubProvider.Result.retryable("prewrite"));
    service.process(2L); service.process(2L); service.process(2L); assertThat(retry.getState()).isEqualTo(CommitJobState.FAILED); assertThat(retry.getAttempts()).isEqualTo(3);
    GithubCommitJob unknown=new GithubCommitJob(user,"capture",7); set(unknown,"id",3L); when(jobs.findByIdForClaim(3L)).thenReturn(Optional.of(unknown)); when(jobs.findById(3L)).thenReturn(Optional.of(unknown)); when(provider.createOnly(eq(current),eq(capture),any())).thenReturn(GithubProvider.Result.unknown("ambiguous"));
    service.process(3L); service.process(3L); assertThat(unknown.getState()).isEqualTo(CommitJobState.UNKNOWN); verify(provider,times(4)).createOnly(eq(current),eq(capture),any());
  }

  @Test void onlyStaleRunningLeasesBecomeUnknownWithoutReclaimingThem() throws Exception {
    GithubCommitJobRepository jobs=mock(GithubCommitJobRepository.class); UserSettingsRepository settingsRepo=mock(UserSettingsRepository.class); SolutionRepository solutions=mock(SolutionRepository.class); GithubProvider provider=mock(GithubProvider.class);
    AppUser user=AppUser.fromGithub("1","owner","Owner",null); GithubCommitJob fresh=new GithubCommitJob(user,"fresh",1); fresh.start(); GithubCommitJob stale=new GithubCommitJob(user,"stale",1); stale.start(); set(stale,"updatedAt",Instant.now().minusSeconds(600));
    when(jobs.findTop25ByStateAndUpdatedAtBeforeOrderByCreatedAtAsc(eq(CommitJobState.RUNNING),any())).thenReturn(List.of(stale)); when(jobs.findTop25ByStateOrderByCreatedAtAsc(CommitJobState.PENDING)).thenReturn(List.of());
    new GithubAutomationService(jobs,settingsRepo,solutions,provider).poll(); assertThat(fresh.getState()).isEqualTo(CommitJobState.RUNNING); assertThat(stale.getState()).isEqualTo(CommitJobState.UNKNOWN); verifyNoInteractions(provider);
  }

  @Test void lockedClaimPreventsASecondProviderExecution() throws Exception {
    GithubCommitJobRepository jobs=mock(GithubCommitJobRepository.class); UserSettingsRepository settingsRepo=mock(UserSettingsRepository.class); SolutionRepository solutions=mock(SolutionRepository.class); GithubProvider provider=mock(GithubProvider.class);
    AppUser user=AppUser.fromGithub("1","owner","Owner",null); set(user,"id",1L); UserSettings current=settings(user,1,Instant.EPOCH); Solution capture=solution(user,"capture",Instant.now()); GithubCommitJob job=new GithubCommitJob(user,"capture",1); set(job,"id",11L);
    when(jobs.findByIdForClaim(11L)).thenReturn(Optional.of(job)); when(jobs.findById(11L)).thenReturn(Optional.of(job)); when(settingsRepo.findByUserId(1L)).thenReturn(Optional.of(current)); when(solutions.findByUserIdAndCaptureId(1L,"capture")).thenReturn(Optional.of(capture)); when(provider.createOnly(eq(current),eq(capture),any())).thenReturn(GithubProvider.Result.succeeded());
    GithubAutomationService service=new GithubAutomationService(jobs,settingsRepo,solutions,provider); service.process(11L); service.process(11L);
    verify(jobs,times(2)).findByIdForClaim(11L); verify(provider,times(1)).createOnly(eq(current),eq(capture),any()); assertThat(job.getState()).isEqualTo(CommitJobState.SUCCEEDED);
  }

  @Test void finalWriteGuardRechecksSettingsAfterTheDurableClaim() throws Exception {
    GithubCommitJobRepository jobs=mock(GithubCommitJobRepository.class); UserSettingsRepository settingsRepo=mock(UserSettingsRepository.class); SolutionRepository solutions=mock(SolutionRepository.class); GithubProvider provider=mock(GithubProvider.class);
    AppUser user=AppUser.fromGithub("1","owner","Owner",null); set(user,"id",1L); UserSettings claimed=settings(user,1,Instant.EPOCH); UserSettings changed=settings(user,2,Instant.EPOCH); Solution capture=solution(user,"capture",Instant.now()); GithubCommitJob job=new GithubCommitJob(user,"capture",1); set(job,"id",12L);
    when(jobs.findByIdForClaim(12L)).thenReturn(Optional.of(job)); when(jobs.findById(12L)).thenReturn(Optional.of(job)); when(settingsRepo.findByUserId(1L)).thenReturn(Optional.of(claimed),Optional.of(changed)); when(solutions.findByUserIdAndCaptureId(1L,"capture")).thenReturn(Optional.of(capture));
    doAnswer(invocation -> { assertThat(((GithubProvider.FinalWriteGuard)invocation.getArgument(2)).stillAuthorized()).isFalse(); return GithubProvider.Result.failed("consent changed"); }).when(provider).createOnly(eq(claimed),eq(capture),any());
    new GithubAutomationService(jobs,settingsRepo,solutions,provider).process(12L);
    assertThat(job.getState()).isEqualTo(CommitJobState.FAILED);
  }

  @Test void targetChangeRefreshesBoundaryButThemeOnlyChangeDoesNot() throws Exception {
    AppUser user=AppUser.fromGithub("1","owner","Owner",null); UserSettings setting=settings(user,1,Instant.EPOCH); Instant before=setting.getAutomationEnabledAt();
    setting.apply(new SettingsRequest(1,"n","n",false,false,"{number}","{number}","Add {platform} {number} solution","one-light","dracula",true,true,1L,"owner","repo","main",null));
    assertThat(setting.getAutomationEnabledAt()).isEqualTo(before);
    setting.apply(new SettingsRequest(1,"n","n",false,false,"{number}","{number}","Solve {platform} {number}","one-light","dracula",true,true,1L,"owner","repo","main",null));
    assertThat(setting.getAutomationEnabledAt()).isAfter(before);
    setting.apply(new SettingsRequest(1,"n","n",false,false,"{number}","new/{number}","Add {platform} {number} solution","one-light","dracula",true,true,1L,"owner","repo","main",null));
    assertThat(setting.getAutomationEnabledAt()).isAfter(before);
  }

  @Test void commitStatusesAreLimitedToTheRequestedUserAndCaptures() throws Exception {
    GithubCommitJobRepository jobs=mock(GithubCommitJobRepository.class); AppUser user=AppUser.fromGithub("1","owner","Owner",null); set(user,"id",1L);
    GithubCommitJob succeeded=new GithubCommitJob(user,"capture-a",1); succeeded.start(); succeeded.terminal(CommitJobState.SUCCEEDED);
    when(jobs.findByUserIdAndCaptureIdIn(1L,List.of("capture-a","capture-b"))).thenReturn(List.of(succeeded));
    GithubAutomationService service=new GithubAutomationService(jobs,mock(UserSettingsRepository.class),mock(SolutionRepository.class),mock(GithubProvider.class));
    assertThat(service.statuses(user,List.of("capture-a","capture-b"))).containsExactlyEntriesOf(java.util.Map.of("capture-a",CommitJobState.SUCCEEDED));
    verify(jobs).findByUserIdAndCaptureIdIn(1L,List.of("capture-a","capture-b"));
  }

  private static UserSettings settings(AppUser user,long version,Instant boundary) throws Exception { UserSettings s=new UserSettings(user); s.apply(new SettingsRequest(0,"n","n",false,false,"{number}","{number}","Add {platform} {number} solution","github-light","github-dark",true,true,1L,"owner","repo","main",null)); set(s,"version",version); set(s,"automationEnabledAt",boundary); return s; }
  private static Solution solution(AppUser u,String id,Instant observed){ return new Solution(u,id,Platform.SWEA,"1","T","https://example.test","Java","class X{}","ACCEPTED",observed,observed,null,null); }
  private static void set(Object target,String name,Object value)throws Exception{Field f=target.getClass().getDeclaredField(name);f.setAccessible(true);f.set(target,value);}
}
