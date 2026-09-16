package com.codearchive.api.automation;
import java.time.Instant; import java.util.*; import jakarta.persistence.LockModeType; import org.springframework.data.jpa.repository.JpaRepository; import org.springframework.data.jpa.repository.Lock; import org.springframework.data.jpa.repository.Query;
public interface GithubCommitJobRepository extends JpaRepository<GithubCommitJob,Long>{
 Optional<GithubCommitJob> findByUserIdAndCaptureId(Long userId,String captureId);
 List<GithubCommitJob> findTop25ByStateOrderByCreatedAtAsc(CommitJobState state);
 List<GithubCommitJob> findTop25ByStateAndUpdatedAtBeforeOrderByCreatedAtAsc(CommitJobState state,Instant cutoff);
 @Lock(LockModeType.PESSIMISTIC_WRITE) @Query("select job from GithubCommitJob job where job.id=?1") Optional<GithubCommitJob> findByIdForClaim(Long id);
}
