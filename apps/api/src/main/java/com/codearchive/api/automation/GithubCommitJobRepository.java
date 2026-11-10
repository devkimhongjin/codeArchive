package com.codearchive.api.automation;
import java.time.Instant; import java.util.*; import jakarta.persistence.LockModeType; import org.springframework.data.jpa.repository.JpaRepository; import org.springframework.data.jpa.repository.Lock; import org.springframework.data.jpa.repository.Query;
public interface GithubCommitJobRepository extends JpaRepository<GithubCommitJob,Long>{
 Optional<GithubCommitJob> findByUserIdAndCaptureId(Long userId,String captureId);
 List<GithubCommitJob> findByUserIdAndCaptureIdIn(Long userId,Collection<String> captureIds);
 List<GithubCommitJob> findTop25ByStateOrderByCreatedAtAsc(CommitJobState state);
 @Lock(LockModeType.PESSIMISTIC_WRITE) List<GithubCommitJob> findTop25ByStateAndUpdatedAtBeforeOrderByCreatedAtAsc(CommitJobState state,Instant cutoff);
 @Lock(LockModeType.PESSIMISTIC_WRITE) @Query("select job from GithubCommitJob job where job.id=?1") Optional<GithubCommitJob> findByIdForClaim(Long id);
 /** Whether another submission of this problem in this language already has a commit job that did not fail. */
 @Query("select count(job)>0 from GithubCommitJob job, com.codearchive.api.solution.Solution s where job.user.id=:userId and s.user.id=:userId and s.captureId=job.captureId"
   +" and s.platform=:platform and s.problemNumber=:problemNumber and s.languageKey=:languageKey and job.captureId<>:captureId and job.state<>:failed")
 boolean existsCommitForProblem(@org.springframework.data.repository.query.Param("userId") Long userId,@org.springframework.data.repository.query.Param("platform") com.codearchive.api.solution.Platform platform,
   @org.springframework.data.repository.query.Param("problemNumber") String problemNumber,@org.springframework.data.repository.query.Param("languageKey") String languageKey,
   @org.springframework.data.repository.query.Param("captureId") String captureId,@org.springframework.data.repository.query.Param("failed") CommitJobState failed);
}
