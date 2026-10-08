package com.codearchive.api.support;

import java.time.Instant;
import java.util.Optional;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;

public interface SupportInquiryRepository extends JpaRepository<SupportInquiry, Long> {
    Page<SupportInquiry> findByOwnerIdOrderByUpdatedAtDescIdDesc(long ownerId, Pageable pageable);
    Page<SupportInquiry> findAllByOrderByUpdatedAtDescIdDesc(Pageable pageable);
    Optional<SupportInquiry> findByIdAndOwnerId(long id, long ownerId);
    @Lock(LockModeType.PESSIMISTIC_WRITE) @Query("select i from SupportInquiry i where i.id = :id")
    Optional<SupportInquiry> lockById(@Param("id") long id);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select i from SupportInquiry i where i.status = com.codearchive.api.support.SupportStatus.CLOSED and i.closedAt < :cutoff")
    List<SupportInquiry> lockClosedBefore(@Param("cutoff") Instant cutoff);
}
