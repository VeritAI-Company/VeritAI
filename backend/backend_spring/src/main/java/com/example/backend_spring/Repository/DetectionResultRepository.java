package com.example.backend_spring.Repository;

import com.example.backend_spring.Entity.DetectionResultEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface DetectionResultRepository extends JpaRepository<DetectionResultEntity, Long> {
    Optional<DetectionResultEntity> findByRequestId(Long requestId);

    List<DetectionResultEntity> findByRequestIdIn(Collection<Long> requestIds);
}
