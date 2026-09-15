package com.codearchive.api.solution;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SolutionRepository extends JpaRepository<Solution, Long> {
    Optional<Solution> findByUserIdAndCaptureId(Long userId, String captureId);

    List<Solution> findByUserIdOrderBySolvedAtDesc(Long userId);
}
