package com.example.backend_spring.Service;

import com.example.backend_spring.Config.AppProperties;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

@Component
@ConditionalOnProperty(
        prefix = "app.detection",
        name = "queue-provider",
        havingValue = "in-memory",
        matchIfMissing = true
)
public class InMemoryDetectionJobQueue implements DetectionJobQueue {
    private final ArrayBlockingQueue<DetectionJob> queue;
    private final Set<Long> enqueuedIds = ConcurrentHashMap.newKeySet();

    public InMemoryDetectionJobQueue(AppProperties appProperties) {
        this.queue = new ArrayBlockingQueue<>(Math.max(1, appProperties.getDetection().getQueueCapacity()));
    }

    @Override
    public boolean offer(DetectionJob job) {
        if (!enqueuedIds.add(job.requestId())) {
            return true;
        }
        if (queue.offer(job)) {
            return true;
        }
        enqueuedIds.remove(job.requestId());
        return false;
    }

    @Override
    public DetectionJob poll(long timeout, TimeUnit unit) throws InterruptedException {
        DetectionJob job = queue.poll(timeout, unit);
        if (job != null) {
            enqueuedIds.remove(job.requestId());
        }
        return job;
    }

    @Override
    public int size() {
        return queue.size();
    }

    @Override
    public int remainingCapacity() {
        return queue.remainingCapacity();
    }

    @Override
    public int capacity() {
        return queue.size() + queue.remainingCapacity();
    }
}
