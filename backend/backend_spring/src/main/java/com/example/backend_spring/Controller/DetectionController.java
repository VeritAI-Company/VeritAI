package com.example.backend_spring.Controller;

import com.example.backend_spring.Dto.AiPredictionDto;
import com.example.backend_spring.Dto.DetectionResponseDto;
import com.example.backend_spring.Dto.FeedbackRequestDto;
import com.example.backend_spring.Entity.DetectionRequestEntity;
import com.example.backend_spring.Entity.DetectionResultEntity;
import com.example.backend_spring.Repository.DetectionRequestRepository;
import com.example.backend_spring.Repository.DetectionResultRepository;
import com.example.backend_spring.Service.DetectionProcessingService;
import com.example.backend_spring.Service.DetectionProcessingService.QueueFullException;
import com.example.backend_spring.Service.DetectionStatus;
import com.example.backend_spring.Service.DetectionUploadService;
import com.example.backend_spring.Service.DetectionUploadService.InvalidUploadException;
import com.example.backend_spring.Service.UploadedDetectionFile;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api")
public class DetectionController {

    private static final Logger log = LoggerFactory.getLogger(DetectionController.class);
    private static final String RETRY_AFTER_SECONDS = "5";
    private final DetectionRequestRepository detectionRequestRepository;
    private final DetectionResultRepository detectionResultRepository;
    private final DetectionProcessingService detectionProcessingService;
    private final DetectionUploadService detectionUploadService;
    private final ObjectMapper objectMapper;
    private final Object dedupLock = new Object();

    public DetectionController(DetectionRequestRepository detectionRequestRepository,
                               DetectionResultRepository detectionResultRepository,
                               DetectionProcessingService detectionProcessingService,
                               DetectionUploadService detectionUploadService,
                               ObjectMapper objectMapper) {
        this.detectionRequestRepository = detectionRequestRepository;
        this.detectionResultRepository = detectionResultRepository;
        this.detectionProcessingService = detectionProcessingService;
        this.detectionUploadService = detectionUploadService;
        this.objectMapper = objectMapper;
    }

    @PostMapping("/detections")
    public ResponseEntity<?> createDetection(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "sourceUrl", required = false) String sourceUrl,
            @RequestParam(value = "mediaType", defaultValue = "image") String mediaType,
            @RequestParam(value = "clientType", defaultValue = "chrome-extension") String clientType,
            @RequestParam(value = "analysisMode", defaultValue = "full_image") String analysisMode
    ) {
        DetectionRequestEntity requestEntity = new DetectionRequestEntity();

        try {
            UploadedDetectionFile uploadedFile = detectionUploadService.storeValidated(file);
            String normalizedAnalysisMode = detectionProcessingService.normalizeAnalysisMode(analysisMode);

            synchronized (dedupLock) {
                Optional<ResponseEntity<?>> reusableResponse = findReusableDetection(uploadedFile.fileHash(), normalizedAnalysisMode);
                if (reusableResponse.isPresent()) {
                    detectionUploadService.deleteQuietly(uploadedFile.path());
                    return reusableResponse.get();
                }

                requestEntity.setSourceUrl(truncate(sourceUrl, 2000));
                requestEntity.setMediaType(mediaType);
                requestEntity.setClientType(clientType);
                requestEntity.setFileName(uploadedFile.originalFileName());
                requestEntity.setFilePath(uploadedFile.path().toString());
                requestEntity.setFileHash(uploadedFile.fileHash());
                requestEntity.setMimeType(uploadedFile.mimeType());
                requestEntity.setFileSize(uploadedFile.fileSize());
                requestEntity.setAnalysisMode(normalizedAnalysisMode);
                requestEntity.setStatus(DetectionStatus.QUEUED.value());
                detectionRequestRepository.save(requestEntity);

                detectionProcessingService.enqueue(requestEntity.getId(), uploadedFile.path(), normalizedAnalysisMode);
            }

            DetectionResponseDto responseDto = new DetectionResponseDto(
                    requestEntity.getId(),
                    requestEntity.getStatus(),
                    "Analysis request queued.",
                    null,
                    detectionProcessingService.recommendedPollDelayMs()
            );

            return ResponseEntity.accepted().body(responseDto);

        } catch (InvalidUploadException e) {
            return buildErrorResponse(HttpStatus.BAD_REQUEST, null, e.getMessage(), null);

        } catch (QueueFullException e) {
            requestEntity.setStatus(DetectionProcessingService.STATUS_FAILED);
            if (requestEntity.getId() != null) {
                detectionRequestRepository.save(requestEntity);
            }

            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .header("Retry-After", RETRY_AFTER_SECONDS)
                    .body(buildErrorDto(
                            requestEntity.getId(),
                            "Detection queue is full. Please retry later.",
                            detectionProcessingService.recommendedPollDelayMs()
                    ));

        } catch (Exception e) {
            requestEntity.setStatus(DetectionProcessingService.STATUS_FAILED);
            if (requestEntity.getId() != null) {
                detectionRequestRepository.save(requestEntity);
            }

            return buildErrorResponse(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    requestEntity.getId(),
                    "Analysis failed: " + e.getMessage(),
                    null
            );
        }
    }

    @GetMapping("/detections/status")
    public ResponseEntity<?> getDetectionStatuses(@RequestParam("ids") List<Long> requestIds) {
        List<DetectionResponseDto> items = new ArrayList<>();
        Map<Long, DetectionRequestEntity> requestsById = new LinkedHashMap<>();
        detectionRequestRepository.findAllById(requestIds).forEach(requestEntity ->
                requestsById.put(requestEntity.getId(), requestEntity)
        );
        for (Long requestId : requestIds) {
            if (requestId == null) {
                continue;
            }
            DetectionRequestEntity requestEntity = requestsById.get(requestId);
            if (requestEntity != null) {
                items.add(buildDetectionResponse(requestEntity));
            }
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("items", items);
        payload.put("queue", detectionProcessingService.getQueueMetrics());
        return ResponseEntity.ok(payload);
    }

    @GetMapping("/detections/{requestId}")
    public ResponseEntity<?> getDetection(@PathVariable Long requestId) {
        Optional<DetectionRequestEntity> requestOpt = detectionRequestRepository.findById(requestId);
        if (requestOpt.isEmpty()) {
            return buildErrorResponse(HttpStatus.NOT_FOUND, requestId, "Request not found.", null);
        }

        return ResponseEntity.ok(buildDetectionResponse(requestOpt.get()));
    }

    @GetMapping("/detections/queue")
    public ResponseEntity<?> getDetectionQueueMetrics() {
        return ResponseEntity.ok(detectionProcessingService.getQueueMetrics());
    }

    @PostMapping("/feedback")
    public ResponseEntity<?> receiveFeedback(@RequestBody FeedbackRequestDto feedbackDto) {
        log.info("Feedback received - ID: {}, reason: {}", feedbackDto.getRequestId(), feedbackDto.getReason());

        Optional<DetectionRequestEntity> requestOpt = detectionRequestRepository.findById(feedbackDto.getRequestId());
        if (requestOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(java.util.Map.of("status", "FAILED", "message", "Request not found."));
        }

        DetectionRequestEntity entity = requestOpt.get();
        entity.setReported(true);
        entity.setReportedAt(feedbackDto.getReportedAt());
        entity.setReportReason(feedbackDto.getReason());
        detectionRequestRepository.save(entity);

        return ResponseEntity.ok(java.util.Map.of("status", "SUCCESS"));
    }

    @GetMapping("/feedback/list")
    public ResponseEntity<?> getFeedbackList() {
        List<DetectionRequestEntity> reportedList = detectionRequestRepository.findByIsReportedTrue();
        return ResponseEntity.ok(reportedList);
    }

    private AiPredictionDto deserializeResult(DetectionResultEntity resultEntity) {
        if (resultEntity.getRawResultJson() != null && !resultEntity.getRawResultJson().isBlank()) {
            try {
                return objectMapper.readValue(resultEntity.getRawResultJson(), AiPredictionDto.class);
            } catch (Exception ignored) {
            }
        }

        AiPredictionDto resultDto = new AiPredictionDto();
        resultDto.setDeepfake(resultEntity.isDeepfake());
        resultDto.setConfidence(resultEntity.getConfidence());
        resultDto.setFaceCount(resultEntity.getFaceCount());
        resultDto.setWatermarkDetected(resultEntity.isWatermarkDetected());
        resultDto.setModelVersion(resultEntity.getModelVersion());
        resultDto.setProcessingTimeMs(resultEntity.getProcessingTimeMs());
        resultDto.setMessage(resultEntity.getMessage());
        return resultDto;
    }

    private DetectionResponseDto buildDetectionResponse(DetectionRequestEntity requestEntity) {
        Optional<DetectionResultEntity> resultOpt = detectionResultRepository.findByRequestId(requestEntity.getId());
        AiPredictionDto resultDto = resultOpt.map(this::deserializeResult).orElse(null);
        return new DetectionResponseDto(
                requestEntity.getId(),
                requestEntity.getStatus(),
                getStatusMessage(requestEntity),
                resultDto,
                isPendingStatus(requestEntity.getStatus()) ? detectionProcessingService.recommendedPollDelayMs() : null
        );
    }

    private Optional<ResponseEntity<?>> findReusableDetection(String fileHash, String analysisMode) {
        Optional<DetectionRequestEntity> existingOpt =
                detectionRequestRepository.findFirstByFileHashAndAnalysisModeAndStatusInOrderByCreatedAtDesc(
                        fileHash,
                        analysisMode,
                        DetectionStatus.reusableValues()
                );
        if (existingOpt.isEmpty()) {
            return Optional.empty();
        }

        DetectionRequestEntity existing = existingOpt.get();
        Optional<DetectionResultEntity> resultOpt = detectionResultRepository.findByRequestId(existing.getId());
        AiPredictionDto resultDto = resultOpt.map(this::deserializeResult).orElse(null);

        if (DetectionProcessingService.STATUS_DONE.equals(existing.getStatus()) && resultDto != null) {
            DetectionResponseDto responseDto = new DetectionResponseDto(
                    existing.getId(),
                    existing.getStatus(),
                    "Duplicate analysis reused.",
                    resultDto,
                    null
            );
            return Optional.of(ResponseEntity.ok(responseDto));
        }

        if (isPendingStatus(existing.getStatus())) {
            DetectionResponseDto responseDto = new DetectionResponseDto(
                    existing.getId(),
                    existing.getStatus(),
                    "Duplicate analysis already queued.",
                    null,
                    detectionProcessingService.recommendedPollDelayMs()
            );
            return Optional.of(ResponseEntity.accepted().body(responseDto));
        }

        return Optional.empty();
    }

    private boolean isPendingStatus(String status) {
        return DetectionStatus.from(status).map(DetectionStatus::isPending).orElse(false);
    }

    private ResponseEntity<DetectionResponseDto> buildErrorResponse(
            HttpStatus status,
            Long requestId,
            String message,
            Integer retryAfterMs
    ) {
        return ResponseEntity.status(status).body(buildErrorDto(requestId, message, retryAfterMs));
    }

    private DetectionResponseDto buildErrorDto(Long requestId, String message, Integer retryAfterMs) {
        return new DetectionResponseDto(
                requestId,
                DetectionProcessingService.STATUS_FAILED,
                message,
                null,
                retryAfterMs
        );
    }

    private String truncate(String value, int maxLength) {
        if (value == null) return null;
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }

    private String getStatusMessage(DetectionRequestEntity requestEntity) {
        String status = requestEntity.getStatus();
        return DetectionStatus.from(status)
                .map(detectionStatus -> switch (detectionStatus) {
                    case QUEUED -> "Analysis request is queued.";
                    case PROCESSING -> "Analysis is processing.";
                    case DONE -> "Analysis completed.";
                    case FAILED -> {
                        if (requestEntity.getFailureMessage() != null && !requestEntity.getFailureMessage().isBlank()) {
                            yield requestEntity.getFailureMessage();
                        }
                        yield "Analysis failed.";
                    }
                })
                .orElse("Analysis status loaded.");
    }
}
