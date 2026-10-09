package com.codearchive.api.support;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SupportMessageRepository extends JpaRepository<SupportMessage, Long> {
    List<SupportMessage> findByInquiryIdOrderByIdAsc(long inquiryId);
    Optional<SupportMessage> findFirstByInquiryIdAndAuthorRoleOrderByIdDesc(long inquiryId, SupportAuthorRole authorRole);
}
