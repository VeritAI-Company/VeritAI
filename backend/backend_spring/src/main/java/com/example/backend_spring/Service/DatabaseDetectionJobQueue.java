package com.example.backend_spring.Service;

import com.example.backend_spring.Config.AppProperties;
import com.example.backend_spring.Entity.DetectionRequestEntity;
import com.example.backend_spring.Repository.DetectionRequestRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.concurrent.TimeUnit;

/**
 * Durable queue provider backed by detection_request rows. Multiple application
 * instances may poll the same row safely because processing ownership is
 * acquired later through a conditional status update.
 */
@Component
@ConditionalOnProperty(prefix = "app.detection", name = "queue-provider", havingValue = "database")
public class DatabaseDetectionJobQueue implements DetectionJobQueue {
    private final DetectionRequestRepository repository;
    private final int capacity;
    private final long pollIntervalMs;

    public DatabaseDetectionJobQueue(DetectionRequestRepository repository, AppProperties appProperties) {
        this.repository = repository;
        this.capacity = Math.max(1, appProperties.getDetection().getDatabaseQueueCapacity());
        this.pollIntervalMs = Math.max(10, appProperties.getDetection().getDatabaseQueuePollIntervalMs());
    }

    @Override
    public boolean offer(DetectionJob job) {
        return size() <= capacity;
    }

    @Override
    public DetectionJob poll(long timeout, TimeUnit unit) throws InterruptedException {
        long deadline = System.nanoTime() + unit.toNanos(timeout);
        do {
            Optional<DetectionRequestEntity> next = repository.findFirstByStatusOrderByCreatedAtAsc(
                    DetectionStatus.QUEUED.value()
            );
            if (next.isPresent()) {
                DetectionRequestEntity request = next.get();
                return new DetectionJob(request.getId(), request.getFilePath(), request.getAnalysisMode());
            }
            long remainingMs = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime());
            if (remainingMs <= 0) {
                return null;
            }
            Thread.sleep(Math.min(pollIntervalMs, remainingMs));
        } while (!Thread.currentThread().isInterrupted());
        throw new InterruptedException();
    }

    @Override
    public int size() {
        return Math.toIntExact(Math.min(Integer.MAX_VALUE, repository.countByStatus(DetectionStatus.QUEUED.value())));
    }

    @Override
    public int remainingCapacity() {
        return Math.max(0, capacity - size());
    }

    @Override
    public int capacity() {
        return capacity;
    }

    @Override
    public boolean durable() {
        return true;
    }
}
