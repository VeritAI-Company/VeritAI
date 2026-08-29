package com.example.backend_spring.Entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "detection_result")
public class DetectionResultEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private Long requestId;
    private boolean isDeepfake;
    private double confidence;
    private int faceCount;
    private boolean watermarkDetected;
    private String modelVersion;
    private long processingTimeMs;

    @Column(length = 1000)
    private String message;

    @Lob
    @Column(columnDefinition = "TEXT")
    private String rawResultJson;

    private LocalDateTime createdAt;

    public DetectionResultEntity() {
    }

    @PrePersist
    public void onCreate() {
        this.createdAt = LocalDateTime.now();
    }

    public Long getId() {
        return id;
    }

    public Long getRequestId() {
        return requestId;
    }

    public void setRequestId(Long requestId) {
        this.requestId = requestId;
    }

    public boolean isDeepfake() {
        return isDeepfake;
    }

    public void setDeepfake(boolean deepfake) {
        isDeepfake = deepfake;
    }

    public double getConfidence() {
        return confidence;
    }

    public void setConfidence(double confidence) {
        this.confidence = confidence;
    }

    public int getFaceCount() {
        return faceCount;
    }

    public void setFaceCount(int faceCount) {
        this.faceCount = faceCount;
    }

    public boolean isWatermarkDetected() {
        return watermarkDetected;
    }

    public void setWatermarkDetected(boolean watermarkDetected) {
        this.watermarkDetected = watermarkDetected;
    }

    public String getModelVersion() {
        return modelVersion;
    }

    public void setModelVersion(String modelVersion) {
        this.modelVersion = modelVersion;
    }

    public long getProcessingTimeMs() {
        return processingTimeMs;
    }

    public void setProcessingTimeMs(long processingTimeMs) {
        this.processingTimeMs = processingTimeMs;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String summary) {
        this.message = summary;
    }

    public String getRawResultJson() {
        return rawResultJson;
    }

    public void setRawResultJson(String rawResultJson) {
        this.rawResultJson = rawResultJson;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
