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
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
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
    private final BlockingQueue<DetectionJob> queue;
    private final int queueCapacity;
    private final List<Thread> workers = new ArrayList<>();
    private final AtomicInteger activeProcessingCount = new AtomicInteger(0);
    private final AtomicLong totalEnqueuedCount = new AtomicLong(0);
    private final AtomicLong totalCompletedCount = new AtomicLong(0);
    private final AtomicLong totalFailedCount = new AtomicLong(0);
    private final AtomicLong totalAiCallCount = new AtomicLong(0);
    private final AtomicLong totalRetryCount = new AtomicLong(0);
    private final AtomicLong totalProcessingTimeMs = new AtomicLong(0);
    private final AtomicLong totalAiCallTimeMs = new AtomicLong(0);

    private volatile boolean running = true;

    public DetectionProcessingService(RestTemplate restTemplate,
                                      DetectionRequestRepository detectionRequestRepository,
                                      DetectionResultRepository detectionResultRepository,
                                      ObjectMapper objectMapper,
                                      AppProperties appProperties) {
        this.restTemplate = restTemplate;
        this.detectionRequestRepository = detectionRequestRepository;
        this.detectionResultRepository = detectionResultRepository;
        this.objectMapper = objectMapper;
        this.appProperties = appProperties;
        this.queueCapacity = appProperties.getDetection().getQueueCapacity();
        this.queue = new ArrayBlockingQueue<>(this.queueCapacity);
    }

    @PostConstruct
    public void startWorkers() {
        int count = Math.max(1, appProperties.getDetection().getWorkerCount());
        for (int i = 0; i < count; i += 1) {
            Thread worker = new Thread(this::runWorker, "veritai-detection-worker-" + (i + 1));
            worker.setDaemon(true);
            worker.start();
            workers.add(worker);
        }
        recoverPendingRequests();
    }

    @PreDestroy
    public void stopWorkers() {
        running = false;
        for (Thread worker : workers) {
            worker.interrupt();
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
            DetectionRequestEntity requestEntity = detectionRequestRepository.findById(job.requestId())
                    .orElseThrow(() -> new IllegalStateException("Detection request not found: " + job.requestId()));

            if (detectionResultRepository.findByRequestId(job.requestId()).isPresent()) {
                requestEntity.setStatus(DetectionStatus.DONE.value());
                detectionRequestRepository.save(requestEntity);
                totalCompletedCount.incrementAndGet();
                return;
            }

            requestEntity.setStatus(DetectionStatus.PROCESSING.value());
            requestEntity.setFailureMessage(null);
            detectionRequestRepository.save(requestEntity);

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
            detectionRequestRepository.save(requestEntity);
            totalCompletedCount.incrementAndGet();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            detectionRequestRepository.findById(job.requestId()).ifPresent(requestEntity -> {
                requestEntity.setStatus(DetectionStatus.QUEUED.value());
                detectionRequestRepository.save(requestEntity);
            });
        } catch (Exception e) {
            detectionRequestRepository.findById(job.requestId()).ifPresent(requestEntity -> {
                requestEntity.setStatus(DetectionStatus.FAILED.value());
                requestEntity.setFailureMessage(buildFailureMessage(e));
                detectionRequestRepository.save(requestEntity);
            });
            totalFailedCount.incrementAndGet();
        } finally {
            activeProcessingCount.decrementAndGet();
            totalProcessingTimeMs.addAndGet(Math.max(0, System.currentTimeMillis() - processingStarted));
        }
    }

    private void recoverPendingRequests() {
        Set<String> pendingStatuses = DetectionStatus.pendingValues();
        List<DetectionRequestEntity> pendingRequests = detectionRequestRepository.findByStatusIn(pendingStatuses);
        for (DetectionRequestEntity requestEntity : pendingRequests) {
            if (detectionResultRepository.findByRequestId(requestEntity.getId()).isPresent()) {
                requestEntity.setStatus(DetectionStatus.DONE.value());
                detectionRequestRepository.save(requestEntity);
                continue;
            }

            Path filePath = Paths.get(requestEntity.getFilePath());
            if (!Files.exists(filePath)) {
                requestEntity.setStatus(DetectionStatus.FAILED.value());
                detectionRequestRepository.save(requestEntity);
                continue;
            }

            requestEntity.setStatus(DetectionStatus.QUEUED.value());
            detectionRequestRepository.save(requestEntity);
            if (!queue.offer(new DetectionJob(
                    requestEntity.getId(),
                    requestEntity.getFilePath(),
                    normalizeAnalysisMode(requestEntity.getAnalysisMode())
            ))) {
                break;
            }
            totalEnqueuedCount.incrementAndGet();
        }
    }

    private AiPredictionDto callAiServerWithRetry(Path filePath, String analysisMode) throws InterruptedException {
        int attempts = Math.max(1, appProperties.getDetection().getAiRetryCount() + 1);
        RuntimeException lastError = null;
        for (int attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                totalAiCallCount.incrementAndGet();
                long aiStarted = System.currentTimeMillis();
                AiPredictionDto result = callAiServer(filePath, analysisMode);
                totalAiCallTimeMs.addAndGet(Math.max(0, System.currentTimeMillis() - aiStarted));
                return result;
            } catch (RuntimeException e) {
                lastError = e;
                if (attempt < attempts) {
                    totalRetryCount.incrementAndGet();
                    Thread.sleep(Math.max(0, appProperties.getDetection().getAiRetryDelayMs()));
                }
            }
        }
        throw lastError == null ? new RuntimeException("AI server request failed.") : lastError;
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

    private record DetectionJob(Long requestId, String filePath, String analysisMode) {
    }

    public static class QueueFullException extends RuntimeException {
        public QueueFullException(String message) {
            super(message);
        }
    }
}
