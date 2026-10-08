package com.codearchive.api.support;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SupportMessageRepository extends JpaRepository<SupportMessage, Long> {
    List<SupportMessage> findByInquiryIdOrderByIdAsc(long inquiryId);
    long deleteByInquiryId(long inquiryId);
    long deleteByInquiryIdIn(List<Long> inquiryIds);
}
