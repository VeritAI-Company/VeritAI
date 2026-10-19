package com.example.backend_spring.Service;

import com.example.backend_spring.Config.AppProperties;
import com.example.backend_spring.Entity.DetectionRequestEntity;
import com.example.backend_spring.Repository.DetectionRequestRepository;
import com.example.backend_spring.Repository.DetectionResultRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.SliceImpl;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.RestTemplate;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;

class DetectionJobQueueTest {

    @TempDir
    Path tempDir;

    @Test
    void inMemoryQueueDeduplicatesRecoveredIdsWithoutConsumingCapacity() throws Exception {
        AppProperties properties = new AppProperties();
        properties.getDetection().setQueueCapacity(2);
        InMemoryDetectionJobQueue queue = new InMemoryDetectionJobQueue(properties);

        DetectionJob first = new DetectionJob(1L, "one.png", "full_image");
        assertThat(queue.offer(first)).isTrue();
        assertThat(queue.offer(first)).isTrue();
        assertThat(queue.offer(new DetectionJob(2L, "two.png", "full_image"))).isTrue();
        assertThat(queue.offer(new DetectionJob(3L, "three.png", "full_image"))).isFalse();
        assertThat(queue.size()).isEqualTo(2);

        assertThat(queue.poll(10, TimeUnit.MILLISECONDS).requestId()).isEqualTo(1L);
        assertThat(queue.offer(new DetectionJob(3L, "three.png", "full_image"))).isTrue();
    }

    @Test
    void databaseQueueReadsPersistedPayloadAndReportsDurableCapacity() throws Exception {
        DetectionRequestRepository repository = mock(DetectionRequestRepository.class);
        DetectionRequestEntity queued = new DetectionRequestEntity();
        ReflectionTestUtils.setField(queued, "id", 7L);
        queued.setStatus(DetectionStatus.QUEUED.value());
        queued.setFilePath("persisted.png");
        queued.setAnalysisMode("face_crop_only");
        when(repository.countByStatus(DetectionStatus.QUEUED.value())).thenReturn(1L);
        when(repository.findFirstByStatusOrderByCreatedAtAsc(DetectionStatus.QUEUED.value()))
                .thenReturn(Optional.of(queued));

        AppProperties properties = new AppProperties();
        properties.getDetection().setDatabaseQueueCapacity(1000);
        DatabaseDetectionJobQueue queue = new DatabaseDetectionJobQueue(repository, properties);

        DetectionJob job = queue.poll(10, TimeUnit.MILLISECONDS);
        assertThat(job.requestId()).isEqualTo(7L);
        assertThat(job.filePath()).isEqualTo("persisted.png");
        assertThat(queue.size()).isEqualTo(1);
        assertThat(queue.remainingCapacity()).isEqualTo(999);
    }

    @Test
    void internalDedupFieldsAreNotAddedToFeedbackJsonContract() {
        DetectionRequestEntity entity = new DetectionRequestEntity();
        entity.setDedupKey("internal-key");
        entity.setModelVersion("model-v2");
        entity.setPipelineVersion("pipeline-v2");

        @SuppressWarnings("unchecked")
        Map<String, Object> json = new ObjectMapper().convertValue(entity, Map.class);
        assertThat(json).doesNotContainKeys("dedupKey", "modelVersion", "pipelineVersion");
    }

    @Test
    void pagedRecoveryRefillsBeyondInMemoryCapacityWithoutStrandingJobs() throws Exception {
        Path file = tempDir.resolve("recover.png");
        Files.write(file, new byte[] {1});
        DetectionRequestEntity one = queuedRequest(1L, file);
        DetectionRequestEntity two = queuedRequest(2L, file);
        DetectionRequestEntity three = queuedRequest(3L, file);

        DetectionRequestRepository requestRepository = mock(DetectionRequestRepository.class);
        DetectionResultRepository resultRepository = mock(DetectionResultRepository.class);
        when(resultRepository.findByRequestId(any())).thenReturn(Optional.empty());
        when(requestRepository.findByStatusInAndIdGreaterThanOrderByIdAsc(
                anyCollection(), eq(0L), any(Pageable.class)
        )).thenReturn(new SliceImpl<>(List.of(one, two, three), PageRequest.of(0, 100), false));
        when(requestRepository.findByStatusInAndIdGreaterThanOrderByIdAsc(
                anyCollection(), eq(2L), any(Pageable.class)
        )).thenReturn(new SliceImpl<>(List.of(three)));

        AppProperties properties = new AppProperties();
        properties.getDetection().setQueueCapacity(2);
        InMemoryDetectionJobQueue queue = new InMemoryDetectionJobQueue(properties);
        DetectionProcessingService service = new DetectionProcessingService(
                mock(RestTemplate.class),
                requestRepository,
                resultRepository,
                new ObjectMapper(),
                properties,
                queue
        );

        ReflectionTestUtils.invokeMethod(service, "recoverPendingRequests");
        assertThat(queue.size()).isEqualTo(2);
        assertThat(queue.poll(10, TimeUnit.MILLISECONDS).requestId()).isEqualTo(1L);

        ReflectionTestUtils.invokeMethod(service, "recoverPendingRequests");
        assertThat(queue.poll(10, TimeUnit.MILLISECONDS).requestId()).isEqualTo(2L);
        assertThat(queue.poll(10, TimeUnit.MILLISECONDS).requestId()).isEqualTo(3L);
    }

    private DetectionRequestEntity queuedRequest(Long id, Path file) {
        DetectionRequestEntity request = new DetectionRequestEntity();
        ReflectionTestUtils.setField(request, "id", id);
        request.setStatus(DetectionStatus.QUEUED.value());
        request.setFilePath(file.toString());
        request.setAnalysisMode("full_image");
        return request;
    }
}
