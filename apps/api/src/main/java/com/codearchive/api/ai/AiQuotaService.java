package com.codearchive.api.ai;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.codearchive.api.common.exception.CodeArchiveException;
import com.codearchive.api.common.exception.ErrorCode;

@Service
public class AiQuotaService {

    private final AiDailyUsageRepository usageRepository;
    private final AiProperties properties;

    public AiQuotaService(
            AiDailyUsageRepository usageRepository,
            AiProperties properties
    ) {
        this.usageRepository = usageRepository;
        this.properties = properties;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void consume(UUID userId) {
        boolean consumed = usageRepository.tryConsume(
                userId,
                LocalDate.now(ZoneOffset.UTC),
                properties.getDailyRequestLimit()
        );

        if (!consumed) {
            throw new CodeArchiveException(
                    ErrorCode.RATE_LIMITED
            );
        }
    }
}
