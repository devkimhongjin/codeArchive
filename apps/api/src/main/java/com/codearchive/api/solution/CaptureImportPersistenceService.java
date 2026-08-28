package com.codearchive.api.solution;

import java.time.Instant;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CaptureImportPersistenceService {

    private final SolutionUpsertRepository upsertRepository;

    public CaptureImportPersistenceService(
            SolutionUpsertRepository upsertRepository
    ) {
        this.upsertRepository = upsertRepository;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public CaptureBulkUpsertResponse.Outcome persist(
            UUID userId,
            String clientRecordId,
            SolutionUpsertRepository.Values values,
            Instant now
    ) {
        int inserted = upsertRepository.insertIfAbsent(
                userId,
                clientRecordId,
                values,
                now
        );

        return inserted == 1
                ? CaptureBulkUpsertResponse.Outcome.IMPORTED
                : CaptureBulkUpsertResponse.Outcome.EXISTING;
    }
}
