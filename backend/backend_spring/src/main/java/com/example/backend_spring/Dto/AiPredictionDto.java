package com.example.backend_spring.Dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.Map;

public class AiPredictionDto {

    @JsonProperty("isDeepfake")
    @JsonAlias("deepfake")
    private boolean isDeepfake;
    private double confidence;
    private int faceCount;
    private boolean watermarkDetected;
    private String modelVersion;
    private String analysisMode;
    private Map<String, Object> analysisInput;
    private String analysisScope;
    private String aggregationMethod;
    private double averageProbability;
    private double maxProbability;
    private String winningView;
    private String decisionReason;
    private Map<String, Object> timings;
    private long processingTimeMs;
    private String message;
    private List<Map<String, Object>> faces;
    private Map<String, Object> cnn;
    private Map<String, String> debugImages;
    private String heatmapBase64;

    @JsonProperty("isDeepfake")
    public boolean isDeepfake() {
        return isDeepfake;
    }

    @JsonProperty("isDeepfake")
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

    public String getAnalysisMode() {
        return analysisMode;
    }

    public void setAnalysisMode(String analysisMode) {
        this.analysisMode = analysisMode;
    }

    public Map<String, Object> getAnalysisInput() {
        return analysisInput;
    }

    public void setAnalysisInput(Map<String, Object> analysisInput) {
        this.analysisInput = analysisInput;
    }

    public String getAnalysisScope() {
        return analysisScope;
    }

    public void setAnalysisScope(String analysisScope) {
        this.analysisScope = analysisScope;
    }

    public String getAggregationMethod() {
        return aggregationMethod;
    }

    public void setAggregationMethod(String aggregationMethod) {
        this.aggregationMethod = aggregationMethod;
    }

    public double getAverageProbability() {
        return averageProbability;
    }

    public void setAverageProbability(double averageProbability) {
        this.averageProbability = averageProbability;
    }

    public double getMaxProbability() {
        return maxProbability;
    }

    public void setMaxProbability(double maxProbability) {
        this.maxProbability = maxProbability;
    }

    public String getWinningView() {
        return winningView;
    }

    public void setWinningView(String winningView) {
        this.winningView = winningView;
    }

    public String getDecisionReason() {
        return decisionReason;
    }

    public void setDecisionReason(String decisionReason) {
        this.decisionReason = decisionReason;
    }

    public Map<String, Object> getTimings() {
        return timings;
    }

    public void setTimings(Map<String, Object> timings) {
        this.timings = timings;
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

    public void setMessage(String message) {
        this.message = message;
    }

    public List<Map<String, Object>> getFaces() {
        return faces;
    }

    public void setFaces(List<Map<String, Object>> faces) {
        this.faces = faces;
    }

    public Map<String, Object> getCnn() {
        return cnn;
    }

    public void setCnn(Map<String, Object> cnn) {
        this.cnn = cnn;
    }

    public Map<String, String> getDebugImages() {
        return debugImages;
    }

    public void setDebugImages(Map<String, String> debugImages) {
        this.debugImages = debugImages;
    }

    public String getHeatmapBase64() {
        return heatmapBase64;
    }

    public void setHeatmapBase64(String heatmapBase64) {
        this.heatmapBase64 = heatmapBase64;
    }
}
