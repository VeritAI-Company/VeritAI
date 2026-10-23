package com.example.backend_spring.Service;

import com.example.backend_spring.Config.AppProperties;
import com.example.backend_spring.Dto.AiPredictionDto;
import com.example.backend_spring.Entity.DetectionRequestEntity;
import com.example.backend_spring.Entity.DetectionResultEntity;
import com.example.backend_spring.Repository.DetectionRequestRepository;
import com.example.backend_spring.Repository.DetectionResultRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Slice;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

@Service
public class DetectionProcessingService {

    public static final String STATUS_QUEUED = DetectionStatus.QUEUED.value();
    public static final String STATUS_PROCESSING = DetectionStatus.PROCESSING.value();
    public static final String STATUS_DONE = DetectionStatus.DONE.value();
    public static final String STATUS_FAILED = DetectionStatus.FAILED.value();

    private final RestTemplate restTemplate;
    private final DetectionRequestRepository detectionRequestRepository;
    private final DetectionResultRepository detectionResultRepository;
    private final ObjectMapper objectMapper;
    private final AppProperties appProperties;
    private final DetectionJobQueue queue;
    private final int queueCapacity;
    private ExecutorService workerExecutor;
    private final AtomicInteger activeProcessingCount = new AtomicInteger(0);
    private final AtomicLong totalEnqueuedCount = new AtomicLong(0);
    private final AtomicLong totalCompletedCount = new AtomicLong(0);
    private final AtomicLong totalFailedCount = new AtomicLong(0);
    private final AtomicLong totalAiCallCount = new AtomicLong(0);
    private final AtomicLong totalRetryCount = new AtomicLong(0);
    private final AtomicLong totalProcessingTimeMs = new AtomicLong(0);
    private final AtomicLong totalAiCallTimeMs = new AtomicLong(0);
    private final Semaphore aiCallPermits;
    private final AtomicInteger consecutiveAiFailures = new AtomicInteger(0);
    private final AtomicLong circuitOpenUntilNanos = new AtomicLong(0);
    private long recoveryCursor = 0L;

    private volatile boolean running = true;

    @Autowired
    public DetectionProcessingService(RestTemplate restTemplate,
                                      DetectionRequestRepository detectionRequestRepository,
                                      DetectionResultRepository detectionResultRepository,
                                      ObjectMapper objectMapper,
                                      AppProperties appProperties,
                                      DetectionJobQueue queue) {
        this.restTemplate = restTemplate;
        this.detectionRequestRepository = detectionRequestRepository;
        this.detectionResultRepository = detectionResultRepository;
        this.objectMapper = objectMapper;
        this.appProperties = appProperties;
        this.queue = queue;
        this.queueCapacity = queue.capacity();
        this.aiCallPermits = new Semaphore(
                Math.max(1, appProperties.getDetection().getAiBulkheadConcurrentCalls()),
                true
        );
    }

    public DetectionProcessingService(RestTemplate restTemplate,
                                      DetectionRequestRepository detectionRequestRepository,
                                      DetectionResultRepository detectionResultRepository,
                                      ObjectMapper objectMapper,
                                      AppProperties appProperties) {
        this(
                restTemplate,
                detectionRequestRepository,
                detectionResultRepository,
                objectMapper,
                appProperties,
                new InMemoryDetectionJobQueue(appProperties)
        );
    }

    @PostConstruct
    public void startWorkers() {
        int count = Math.max(1, appProperties.getDetection().getWorkerCount());
        workerExecutor = Executors.newFixedThreadPool(count, runnable -> {
            Thread thread = new Thread(runnable);
            thread.setName("veritai-detection-worker");
            thread.setDaemon(true);
            return thread;
        });
        for (int i = 0; i < count; i += 1) {
            workerExecutor.submit(this::runWorker);
        }
        recoverPendingRequests();
    }

    @PreDestroy
    public void stopWorkers() {
        running = false;
        if (workerExecutor != null) {
            workerExecutor.shutdownNow();
            try {
                workerExecutor.awaitTermination(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    public void enqueue(Long requestId, Path filePath, String analysisMode) {
        DetectionJob job = new DetectionJob(requestId, filePath.toString(), normalizeAnalysisMode(analysisMode));
        if (!queue.offer(job)) {
            throw new QueueFullException("Detection queue is full.");
        }
        totalEnqueuedCount.incrementAndGet();
    }

    private void runWorker() {
        while (running) {
            try {
                DetectionJob job = queue.poll(1, TimeUnit.SECONDS);
                if (job != null) {
                    processJob(job);
                    if (!queue.durable()) {
                        recoverPendingRequests();
                    }
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private void processJob(DetectionJob job) {
        long processingStarted = System.currentTimeMillis();
        activeProcessingCount.incrementAndGet();
        try {
            if (!claimQueuedRequest(job.requestId())) {
                if (detectionResultRepository.findByRequestId(job.requestId()).isPresent()) {
                    transitionStatus(
                            job.requestId(),
                            DetectionStatus.DONE,
                            null,
                            DetectionStatus.pendingValues()
                    );
                }
                return;
            }

            DetectionRequestEntity requestEntity = detectionRequestRepository.findById(job.requestId())
                    .orElseThrow(() -> new IllegalStateException("Detection request not found: " + job.requestId()));

            if (detectionResultRepository.findByRequestId(job.requestId()).isPresent()) {
                requestEntity.setStatus(DetectionStatus.DONE.value());
                transitionStatus(
                        job.requestId(),
                        DetectionStatus.DONE,
                        null,
                        Set.of(DetectionStatus.PROCESSING.value())
                );
                totalCompletedCount.incrementAndGet();
                return;
            }

            requestEntity.setStatus(DetectionStatus.PROCESSING.value());
            requestEntity.setFailureMessage(null);

            AiPredictionDto aiResult = callAiServerWithRetry(Paths.get(job.filePath()), job.analysisMode());

            DetectionResultEntity resultEntity = new DetectionResultEntity();
            resultEntity.setRequestId(requestEntity.getId());
            resultEntity.setDeepfake(aiResult.isDeepfake());
            resultEntity.setConfidence(aiResult.getConfidence());
            resultEntity.setFaceCount(aiResult.getFaceCount());
            resultEntity.setWatermarkDetected(aiResult.isWatermarkDetected());
            resultEntity.setModelVersion(aiResult.getModelVersion());
            resultEntity.setProcessingTimeMs(aiResult.getProcessingTimeMs());
            resultEntity.setMessage(aiResult.getMessage());
            resultEntity.setRawResultJson(serializeResultForStorage(aiResult));
            detectionResultRepository.save(resultEntity);

            requestEntity.setStatus(DetectionStatus.DONE.value());
            transitionStatus(
                    requestEntity.getId(),
                    DetectionStatus.DONE,
                    null,
                    Set.of(DetectionStatus.PROCESSING.value())
            );
            totalCompletedCount.incrementAndGet();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            detectionRequestRepository.findById(job.requestId()).ifPresent(requestEntity -> {
                requestEntity.setStatus(DetectionStatus.QUEUED.value());
                transitionStatus(
                        job.requestId(),
                        DetectionStatus.QUEUED,
                        null,
                        Set.of(DetectionStatus.PROCESSING.value())
                );
            });
        } catch (Exception e) {
            detectionRequestRepository.findById(job.requestId()).ifPresent(requestEntity -> {
                String failureMessage = buildFailureMessage(e);
                requestEntity.setStatus(DetectionStatus.FAILED.value());
                requestEntity.setFailureMessage(failureMessage);
                transitionStatus(
                        job.requestId(),
                        DetectionStatus.FAILED,
                        failureMessage,
                        Set.of(DetectionStatus.QUEUED.value(), DetectionStatus.PROCESSING.value())
                );
                detectionRequestRepository.releaseDedupKey(job.requestId());
            });
            totalFailedCount.incrementAndGet();
        } finally {
            activeProcessingCount.decrementAndGet();
            totalProcessingTimeMs.addAndGet(Math.max(0, System.currentTimeMillis() - processingStarted));
        }
    }

    private synchronized void recoverPendingRequests() {
        Set<String> pendingStatuses = DetectionStatus.pendingValues();
        int pageSize = Math.max(1, appProperties.getDetection().getRecoveryPageSize());
        long lastSeenId = recoveryCursor;
        boolean queueHasCapacity = true;
        while (queueHasCapacity) {
            Slice<DetectionRequestEntity> page = detectionRequestRepository.findByStatusInAndIdGreaterThanOrderByIdAsc(
                    pendingStatuses,
                    lastSeenId,
                    PageRequest.of(0, pageSize)
            );
            if (page.isEmpty()) {
                recoveryCursor = 0L;
                break;
            }
            for (DetectionRequestEntity requestEntity : page.getContent()) {
                if (detectionResultRepository.findByRequestId(requestEntity.getId()).isPresent()) {
                    requestEntity.setStatus(DetectionStatus.DONE.value());
                    transitionStatus(
                            requestEntity.getId(),
                            DetectionStatus.DONE,
                            null,
                            pendingStatuses
                    );
                    lastSeenId = requestEntity.getId();
                    continue;
                }

                Path filePath = Paths.get(requestEntity.getFilePath());
                if (!Files.exists(filePath)) {
                    requestEntity.setStatus(DetectionStatus.FAILED.value());
                    transitionStatus(
                            requestEntity.getId(),
                            DetectionStatus.FAILED,
                            "Uploaded file is missing during startup recovery.",
                            pendingStatuses
                    );
                    detectionRequestRepository.releaseDedupKey(requestEntity.getId());
                    lastSeenId = requestEntity.getId();
                    continue;
                }

                requestEntity.setStatus(DetectionStatus.QUEUED.value());
                transitionStatus(
                        requestEntity.getId(),
                        DetectionStatus.QUEUED,
                        null,
                        pendingStatuses
                );
                if (!queue.durable()) {
                    if (!queue.offer(new DetectionJob(
                            requestEntity.getId(),
                            requestEntity.getFilePath(),
                            normalizeAnalysisMode(requestEntity.getAnalysisMode())
                    ))) {
                        queueHasCapacity = false;
                        break;
                    }
                }
                lastSeenId = requestEntity.getId();
                totalEnqueuedCount.incrementAndGet();
            }
            if (!page.hasNext()) {
                recoveryCursor = 0L;
                break;
            }
        }
        if (!queueHasCapacity) {
            recoveryCursor = lastSeenId;
        }
    }

    private boolean claimQueuedRequest(Long requestId) {
        return transitionStatus(
                requestId,
                DetectionStatus.PROCESSING,
                null,
                Set.of(DetectionStatus.QUEUED.value())
        );
    }

    private boolean transitionStatus(
            Long requestId,
            DetectionStatus nextStatus,
            String failureMessage,
            Set<String> currentStatuses
    ) {
        return detectionRequestRepository.transitionStatus(
                requestId,
                nextStatus.value(),
                failureMessage,
                currentStatuses
        ) > 0;
    }

    private AiPredictionDto callAiServerWithRetry(Path filePath, String analysisMode) throws InterruptedException {
        long bulkheadWaitMs = Math.max(0, appProperties.getDetection().getAiBulkheadWaitMs());
        if (!aiCallPermits.tryAcquire(bulkheadWaitMs, TimeUnit.MILLISECONDS)) {
            throw new AiCallRejectedException("AI server call concurrency limit reached.");
        }
        try {
            return executeAiCallWithRetry(filePath, analysisMode);
        } finally {
            aiCallPermits.release();
        }
    }

    private AiPredictionDto executeAiCallWithRetry(Path filePath, String analysisMode) throws InterruptedException {
        int attempts = Math.max(1, appProperties.getDetection().getAiRetryCount() + 1);
        long timeoutMs = Math.max(1, appProperties.getDetection().getAiRetryTotalTimeoutMs());
        long deadlineNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
        RuntimeException lastError = null;
        for (int attempt = 1; attempt <= attempts; attempt += 1) {
            ensureCircuitAllowsRequest();
            try {
                totalAiCallCount.incrementAndGet();
                long aiStarted = System.currentTimeMillis();
                AiPredictionDto result = callAiServer(filePath, analysisMode);
                totalAiCallTimeMs.addAndGet(Math.max(0, System.currentTimeMillis() - aiStarted));
                consecutiveAiFailures.set(0);
                return result;
            } catch (RuntimeException e) {
                lastError = e;
                if (!isRetryable(e)) {
                    throw e;
                }
                recordTransientFailure();
                if (attempt >= attempts) {
                    break;
                }
                long remainingMs = TimeUnit.NANOSECONDS.toMillis(deadlineNanos - System.nanoTime());
                if (remainingMs <= 0) {
                    break;
                }
                totalRetryCount.incrementAndGet();
                Thread.sleep(Math.min(calculateRetryDelayMs(attempt), remainingMs));
            }
        }
        throw lastError == null ? new RuntimeException("AI server request failed.") : lastError;
    }

    private boolean isRetryable(RuntimeException error) {
        if (error instanceof ResourceAccessException) {
            return true;
        }
        if (error instanceof HttpStatusCodeException statusException) {
            int status = statusException.getStatusCode().value();
            return status == 429 || status == 502 || status == 503 || status == 504;
        }
        return false;
    }

    private long calculateRetryDelayMs(int failedAttempt) {
        long initial = Math.max(0, appProperties.getDetection().getAiRetryDelayMs());
        long maximum = Math.max(initial, appProperties.getDetection().getAiRetryMaxDelayMs());
        long multiplier = 1L << Math.min(20, Math.max(0, failedAttempt - 1));
        long exponential = initial > Long.MAX_VALUE / multiplier ? maximum : initial * multiplier;
        long capped = Math.min(maximum, exponential);
        int jitterPercent = Math.max(0, Math.min(100, appProperties.getDetection().getAiRetryJitterPercent()));
        if (capped == 0 || jitterPercent == 0) {
            return capped;
        }
        long jitterRange = Math.max(1, capped * jitterPercent / 100);
        long jitter = ThreadLocalRandom.current().nextLong(-jitterRange, jitterRange + 1);
        return Math.max(0, capped + jitter);
    }

    private void ensureCircuitAllowsRequest() {
        long openUntil = circuitOpenUntilNanos.get();
        if (openUntil == 0) {
            return;
        }
        long now = System.nanoTime();
        if (now < openUntil) {
            throw new AiCircuitOpenException("AI server circuit breaker is open.");
        }
        circuitOpenUntilNanos.compareAndSet(openUntil, 0);
        consecutiveAiFailures.set(0);
    }

    private void recordTransientFailure() {
        int threshold = Math.max(1, appProperties.getDetection().getAiCircuitFailureThreshold());
        if (consecutiveAiFailures.incrementAndGet() >= threshold) {
            long openMs = Math.max(1, appProperties.getDetection().getAiCircuitOpenMs());
            circuitOpenUntilNanos.set(System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(openMs));
        }
    }

    private AiPredictionDto callAiServer(Path filePath, String analysisMode) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);

        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("file", new FileSystemResource(filePath.toFile()));
        body.add("analysisMode", normalizeAnalysisMode(analysisMode));

        HttpEntity<MultiValueMap<String, Object>> requestEntity = new HttpEntity<>(body, headers);

        ResponseEntity<AiPredictionDto> response = restTemplate.exchange(
                appProperties.getAiServerUrl(),
                HttpMethod.POST,
                requestEntity,
                AiPredictionDto.class
        );

        if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
            throw new RuntimeException("AI server response is invalid.");
        }

        return response.getBody();
    }

    private String serializeResultForStorage(AiPredictionDto aiResult) throws Exception {
        String rawJson = objectMapper.writeValueAsString(aiResult);
        int maxBytes = appProperties.getDetection().getMaxRawResultJsonBytes();
        if (maxBytes <= 0 || rawJson.getBytes(StandardCharsets.UTF_8).length <= maxBytes) {
            return rawJson;
        }

        Map<String, Object> compactPayload = objectMapper.convertValue(
                aiResult,
                new TypeReference<Map<String, Object>>() {
                }
        );
        compactPayload.remove("heatmapBase64");
        compactPayload.remove("debugImages");
        compactPayload.remove("cnn");
        compactPayload.put("rawResultTruncated", true);
        String compactJson = objectMapper.writeValueAsString(compactPayload);
        if (compactJson.getBytes(StandardCharsets.UTF_8).length <= maxBytes) {
            return compactJson;
        }

        compactPayload.remove("faces");
        return objectMapper.writeValueAsString(compactPayload);
    }

    private String buildFailureMessage(Exception e) {
        String detail = e.getMessage();
        if (detail == null || detail.isBlank()) {
            detail = e.getClass().getSimpleName();
        }
        if (e instanceof ResourceAccessException) {
            return truncateFailureMessage("AI server connection or timeout failure: " + detail);
        }
        if (e instanceof HttpStatusCodeException statusException) {
            return truncateFailureMessage("AI server returned HTTP " + statusException.getStatusCode().value() + ": " + detail);
        }
        if (e instanceof RestClientException) {
            return truncateFailureMessage("AI server request failure: " + detail);
        }
        if (detail.contains("AI server response is invalid")) {
            return "AI server response is invalid.";
        }
        return truncateFailureMessage("Detection processing failed: " + detail);
    }

    private String truncateFailureMessage(String message) {
        int maxLength = 1000;
        return message.length() <= maxLength ? message : message.substring(0, maxLength);
    }

    public String normalizeAnalysisMode(String analysisMode) {
        if ("face_crop_only".equals(analysisMode)) {
            return "face_crop_only";
        }
        return "full_image";
    }

    public int recommendedPollDelayMs() {
        int queued = queue.size();
        if (queued >= Math.max(1, queueCapacity * 0.8)) {
            return 5000;
        }
        if (queued >= Math.max(1, queueCapacity * 0.5)) {
            return 3000;
        }
        if (queued > appProperties.getDetection().getWorkerCount()) {
            return 2000;
        }
        return 1000;
    }

    public Map<String, Object> getQueueMetrics() {
        long completed = totalCompletedCount.get();
        long aiCalls = totalAiCallCount.get();
        long avgProcessingMs = completed == 0 ? 0 : totalProcessingTimeMs.get() / completed;
        long avgAiCallMs = aiCalls == 0 ? 0 : totalAiCallTimeMs.get() / aiCalls;
        int workers = Math.max(1, appProperties.getDetection().getWorkerCount());
        long estimatedWaitMs = avgProcessingMs == 0 ? 0 : ((long) Math.ceil(queue.size() / (double) workers)) * avgProcessingMs;
        Map<String, Object> metrics = new LinkedHashMap<>();
        metrics.put("queueCapacity", queueCapacity);
        metrics.put("queuedCount", queue.size());
        metrics.put("remainingCapacity", queue.remainingCapacity());
        metrics.put("workerCount", workers);
        metrics.put("activeProcessingCount", activeProcessingCount.get());
        metrics.put("running", running);
        metrics.put("totalEnqueuedCount", totalEnqueuedCount.get());
        metrics.put("totalCompletedCount", totalCompletedCount.get());
        metrics.put("totalFailedCount", totalFailedCount.get());
        metrics.put("totalAiCallCount", totalAiCallCount.get());
        metrics.put("totalRetryCount", totalRetryCount.get());
        metrics.put("avgProcessingTimeMs", avgProcessingMs);
        metrics.put("avgAiCallTimeMs", avgAiCallMs);
        metrics.put("estimatedWaitMs", estimatedWaitMs);
        metrics.put("recommendedPollDelayMs", recommendedPollDelayMs());
        return metrics;
    }

    public static class QueueFullException extends RuntimeException {
        public QueueFullException(String message) {
            super(message);
        }
    }

    public static class AiCallRejectedException extends RuntimeException {
        public AiCallRejectedException(String message) {
            super(message);
        }
    }

    public static class AiCircuitOpenException extends RuntimeException {
        public AiCircuitOpenException(String message) {
            super(message);
        }
    }
}
