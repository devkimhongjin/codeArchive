package com.codearchive.api.support;

import java.util.Optional;
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
}
