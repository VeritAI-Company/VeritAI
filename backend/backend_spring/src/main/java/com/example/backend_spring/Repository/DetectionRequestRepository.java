package com.example.backend_spring.Repository;

import com.example.backend_spring.Entity.DetectionRequestEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Slice;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface DetectionRequestRepository extends JpaRepository<DetectionRequestEntity, Long> {
    List<DetectionRequestEntity> findByIsReportedTrue();

    List<DetectionRequestEntity> findByStatusIn(Collection<String> statuses);

    List<DetectionRequestEntity> findByStatusInOrderByCreatedAtAsc(Collection<String> statuses);

    Slice<DetectionRequestEntity> findByStatusInAndIdGreaterThanOrderByIdAsc(
            Collection<String> statuses,
            Long lastSeenId,
            Pageable pageable
    );

    Optional<DetectionRequestEntity> findFirstByStatusOrderByCreatedAtAsc(String status);

    long countByStatus(String status);

    Optional<DetectionRequestEntity> findFirstByDedupKeyAndStatusInOrderByCreatedAtDesc(
            String dedupKey,
            Collection<String> statuses
    );

    List<DetectionRequestEntity> findByStatusInAndUpdatedAtBefore(
            Collection<String> statuses,
            LocalDateTime updatedBefore
    );

    Optional<DetectionRequestEntity> findFirstByFileHashAndAnalysisModeAndDedupKeyIsNullAndStatusInOrderByCreatedAtDesc(
            String fileHash,
            String analysisMode,
            Collection<String> statuses
    );

    @Transactional
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            update DetectionRequestEntity request
               set request.status = :nextStatus,
                   request.failureMessage = :failureMessage,
                   request.updatedAt = CURRENT_TIMESTAMP
             where request.id = :requestId
               and request.status in :currentStatuses
            """)
    int transitionStatus(
            @Param("requestId") Long requestId,
            @Param("nextStatus") String nextStatus,
            @Param("failureMessage") String failureMessage,
            @Param("currentStatuses") Collection<String> currentStatuses
    );

    @Transactional
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update DetectionRequestEntity request set request.dedupKey = null where request.id = :requestId")
    int releaseDedupKey(@Param("requestId") Long requestId);
}
