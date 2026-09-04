package com.codearchive.api.integration.github;

import java.time.Instant;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import com.codearchive.api.auth.security.CodeArchivePrincipal;
import com.codearchive.api.common.exception.*;
import com.fasterxml.jackson.databind.ObjectMapper;

@Repository
public class GitHubAutoCommitStore {
    private final JdbcTemplate db;
    private final ObjectMapper json;
    private final TransactionTemplate tx;
    public GitHubAutoCommitStore(JdbcTemplate db, ObjectMapper json, PlatformTransactionManager transactions) {
        this.db=db; this.json=json; tx=new TransactionTemplate(transactions);
        tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW); tx.setTimeout(20);
    }
    boolean start(CodeArchivePrincipal p, UUID id, Target target) {
        try {
            return tx.execute(t -> {
                db.execute("SET LOCAL lock_timeout = '2s'");
                ensurePageOwned(p.userId());
                db.update("UPDATE github_auto_runs SET state='OFF' WHERE user_id=? AND state IN ('STARTING','ACTIVE') AND lease_until<=clock_timestamp()", p.userId());
                if (db.queryForObject("SELECT count(*) FROM github_auto_attempts WHERE user_id=? AND state IN ('ATTEMPTED','UNKNOWN')", Integer.class,p.userId())>0)
                    throw new CodeArchiveException(ErrorCode.GITHUB_UPLOAD_OUTCOME_UNKNOWN);
                // A stop that arrived before enable creates this same ID as OFF; it can never be reactivated.
                return db.update("""
                        INSERT INTO github_auto_runs(id,user_id,session_id,state,target) VALUES(?,?,?,'STARTING',CAST(? AS jsonb))
                        ON CONFLICT(id) DO NOTHING
                        """,id,p.userId(),p.sessionId(),encode(target))==1;
            });
        } catch (DuplicateKeyException ignored) { throw new CodeArchiveException(ErrorCode.GITHUB_AUTO_ACTIVE); }
    }
    void activate(CodeArchivePrincipal p, UUID id) {
        tx.executeWithoutResult(t -> {
            var run=requireLive(p,id,true,"STARTING");
            db.update("UPDATE github_auto_runs SET state='ACTIVE',enabled_at=clock_timestamp(),lease_until=clock_timestamp()+interval '60 seconds' WHERE id=?",run.id());
        });
    }
    void stop(CodeArchivePrincipal p, UUID id) {
        tx.executeWithoutResult(t -> {
            // Wait for a mutation already in progress. A completed OFF response forbids all later sends.
            db.execute("SET LOCAL lock_timeout = '15s'");
            db.update("""
                    INSERT INTO github_auto_runs(id,user_id,session_id,state) VALUES(?,?,?,'OFF')
                    ON CONFLICT(id) DO UPDATE SET state='OFF' WHERE github_auto_runs.user_id=EXCLUDED.user_id
                    """,id,p.userId(),p.sessionId());
            find(p,id,false);
        });
    }
    Run find(CodeArchivePrincipal p, UUID id, boolean lock) {
        return db.query("SELECT * FROM github_auto_runs WHERE id=? AND user_id=?"+(lock?" FOR UPDATE":""),
                (r,i)->new Run(r.getObject("id",UUID.class),r.getObject("session_id",UUID.class),r.getString("state"),
                        decode(r.getString("target")),r.getTimestamp("enabled_at")==null?null:r.getTimestamp("enabled_at").toInstant(),
                        r.getTimestamp("lease_until").toInstant(),r.getString("error_code")),id,p.userId()).stream().findFirst()
                .orElseThrow(()->new CodeArchiveException(ErrorCode.GITHUB_AUTO_STOPPED));
    }
    UUID current(CodeArchivePrincipal p) {
        return db.query("""
                SELECT id FROM github_auto_runs WHERE user_id=?
                ORDER BY (state IN ('STARTING','ACTIVE') AND lease_until>clock_timestamp()) DESC,created_at DESC,id LIMIT 1
                """,(r,i)->r.getObject(1,UUID.class),p.userId())
                .stream().findFirst().orElse(null);
    }
    Run requireLive(CodeArchivePrincipal p, UUID id, boolean lock, String state) {
        ensurePageOwned(p.userId());
        var run=find(p,id,lock);
        if (!run.sessionId().equals(p.sessionId()) || !run.state().equals(state) || !run.leaseUntil().isAfter(Instant.now()))
            throw new CodeArchiveException(ErrorCode.GITHUB_AUTO_STOPPED);
        return run;
    }
    Claim claim(CodeArchivePrincipal p, UUID id) {
        return tx.execute(t -> {
            db.execute("SET LOCAL lock_timeout = '2s'");
            ensurePageOwned(p.userId());
            var run=requireLive(p,id,true,"ACTIVE");
            if (db.queryForObject("SELECT count(*) FROM github_auto_attempts WHERE run_id=? AND state='ATTEMPTED'",Integer.class,id)>0) return null;
            db.update("UPDATE github_auto_runs SET lease_until=clock_timestamp()+interval '60 seconds' WHERE id=?",id);
            UUID source=db.query("""
                    SELECT s.id FROM solutions s WHERE s.user_id=? AND s.accepted_capture AND s.result='ACCEPTED'
                    AND s.created_at>? AND s.observed_at>=? AND s.observed_at<=clock_timestamp()
                    AND NOT EXISTS(SELECT 1 FROM github_auto_attempts a WHERE a.user_id=s.user_id AND a.solution_id=s.id)
                    ORDER BY s.created_at,s.id LIMIT 1
                    """,(r,i)->r.getObject(1,UUID.class),p.userId(),java.sql.Timestamp.from(run.enabledAt()),java.sql.Timestamp.from(run.enabledAt()))
                    .stream().findFirst().orElse(null);
            if (source==null) return null;
            UUID attempt=UUID.randomUUID();
            db.update("INSERT INTO github_auto_attempts(id,run_id,user_id,solution_id,state) VALUES(?,?,?,?,'ATTEMPTED')",attempt,id,p.userId(),source);
            return new Claim(find(p,id,false),attempt,source);
        });
    }
    void finish(Claim claim, GitHubAppClient.CommitResult result, ErrorCode error, boolean sent) {
        tx.executeWithoutResult(t -> {
            // Same lock order as final authorization / OFF.
            db.queryForObject("SELECT id FROM github_auto_runs WHERE id=? FOR UPDATE",UUID.class,claim.run().id());
            String state=result!=null?"SUCCEEDED":sent?"UNKNOWN":"REJECTED";
            if (db.update("UPDATE github_auto_attempts SET state=?,commit_sha=?,commit_url=?,error_code=? WHERE id=? AND state='ATTEMPTED'",
                    state,result==null?null:result.sha(),result==null?null:result.url(),error==null?null:error.name(),claim.attempt())!=1)
                throw new CodeArchiveException(ErrorCode.INTERNAL_ERROR);
            if (result!=null) {
                db.update("UPDATE github_auto_runs SET target=CAST(? AS jsonb) WHERE id=?",encode(claim.run().target().withHead(result.sha())),claim.run().id());
            } else {
                db.update("UPDATE github_auto_runs SET state=CASE WHEN state='OFF' THEN 'OFF' ELSE 'PAUSED' END,error_code=? WHERE id=?",error.name(),claim.run().id());
            }
        });
    }
    LastResult last(UUID id) {
        return db.query("SELECT state,commit_sha,commit_url,error_code FROM github_auto_attempts WHERE run_id=? ORDER BY created_at DESC,id LIMIT 1",
                (r,i)->new LastResult(r.getString(1).equals("ATTEMPTED")?"UNKNOWN":r.getString(1),r.getString(2),r.getString(3),r.getString(4)),id)
                .stream().findFirst().orElse(null);
    }

    private void ensurePageOwned(UUID userId) {
        String mode = db.query("SELECT ownership_mode FROM automation_profiles WHERE user_id=? FOR SHARE",
                (r, i) -> r.getString(1), userId).stream().findFirst().orElse("PAGE_OWNED");
        if (!"PAGE_OWNED".equals(mode)) {
            throw new CodeArchiveException(ErrorCode.AUTOMATION_OWNERSHIP_CONFLICT);
        }
    }
    private String encode(Target target) { try { return json.writeValueAsString(target); } catch(Exception ignored) { throw new CodeArchiveException(ErrorCode.INTERNAL_ERROR); } }
    private Target decode(String value) { try { return value==null?null:json.readValue(value,Target.class); } catch(Exception ignored) { throw new CodeArchiveException(ErrorCode.INTERNAL_ERROR); } }
    public record Target(@com.fasterxml.jackson.annotation.JsonFormat(shape=com.fasterxml.jackson.annotation.JsonFormat.Shape.STRING) long installationId,
            @com.fasterxml.jackson.annotation.JsonFormat(shape=com.fasterxml.jackson.annotation.JsonFormat.Shape.STRING) long repositoryId,
            String branch,String expectedCommitSha,String folder,boolean privateRepository,String fullName) {
        public Target withHead(String head) { return new Target(installationId,repositoryId,branch,head,folder,privateRepository,fullName); }
    }
    record Run(UUID id,UUID sessionId,String state,Target target,Instant enabledAt,Instant leaseUntil,String errorCode) {}
    record Claim(Run run,UUID attempt,UUID source) {}
    public record LastResult(String status,String commitSha,String commitUrl,String errorCode) {}
}
