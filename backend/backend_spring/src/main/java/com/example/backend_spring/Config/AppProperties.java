package com.example.backend_spring.Config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app")
public class AppProperties {

    private String uploadDir = "uploads";
    private String aiServerUrl = "http://localhost:8000/predict";
    private final Ai ai = new Ai();
    private final Cors cors = new Cors();
    private final Detection detection = new Detection();

    public String getUploadDir() {
        return uploadDir;
    }

    public void setUploadDir(String uploadDir) {
        this.uploadDir = uploadDir;
    }

    public String getAiServerUrl() {
        return aiServerUrl;
    }

    public void setAiServerUrl(String aiServerUrl) {
        this.aiServerUrl = aiServerUrl;
    }

    public Ai getAi() {
        return ai;
    }

    public Cors getCors() {
        return cors;
    }

    public Detection getDetection() {
        return detection;
    }

    public static class Ai {
        private int connectTimeoutMs = 3000;
        private int connectionRequestTimeoutMs = 1000;
        private int readTimeoutMs = 30000;
        private int maxConnections = 20;
        private int maxConnectionsPerRoute = 10;
        private int idleConnectionEvictSeconds = 30;

        public int getConnectTimeoutMs() {
            return connectTimeoutMs;
        }

        public void setConnectTimeoutMs(int connectTimeoutMs) {
            this.connectTimeoutMs = connectTimeoutMs;
        }

        public int getReadTimeoutMs() {
            return readTimeoutMs;
        }

        public void setReadTimeoutMs(int readTimeoutMs) {
            this.readTimeoutMs = readTimeoutMs;
        }

        public int getConnectionRequestTimeoutMs() {
            return connectionRequestTimeoutMs;
        }

        public void setConnectionRequestTimeoutMs(int connectionRequestTimeoutMs) {
            this.connectionRequestTimeoutMs = connectionRequestTimeoutMs;
        }

        public int getMaxConnections() {
            return maxConnections;
        }

        public void setMaxConnections(int maxConnections) {
            this.maxConnections = maxConnections;
        }

        public int getMaxConnectionsPerRoute() {
            return maxConnectionsPerRoute;
        }

        public void setMaxConnectionsPerRoute(int maxConnectionsPerRoute) {
            this.maxConnectionsPerRoute = maxConnectionsPerRoute;
        }

        public int getIdleConnectionEvictSeconds() {
            return idleConnectionEvictSeconds;
        }

        public void setIdleConnectionEvictSeconds(int idleConnectionEvictSeconds) {
            this.idleConnectionEvictSeconds = idleConnectionEvictSeconds;
        }
    }

    public static class Cors {
        private String[] allowedOrigins = new String[] {"*"};

        public String[] getAllowedOrigins() {
            return allowedOrigins;
        }

        public void setAllowedOrigins(String[] allowedOrigins) {
            this.allowedOrigins = allowedOrigins;
        }
    }

    public static class Detection {
        private int queueCapacity = 100;
        private String queueProvider = "in-memory";
        private int databaseQueueCapacity = 100000;
        private long databaseQueuePollIntervalMs = 200;
        private int recoveryPageSize = 100;
        private int workerCount = 2;
        private int aiRetryCount = 1;
        private long aiRetryDelayMs = 500;
        private long aiRetryMaxDelayMs = 4000;
        private long aiRetryTotalTimeoutMs = 15000;
        private int aiRetryJitterPercent = 20;
        private int aiBulkheadConcurrentCalls = 2;
        private long aiBulkheadWaitMs = 1000;
        private int aiCircuitFailureThreshold = 5;
        private long aiCircuitOpenMs = 10000;
        private long maxFileSizeBytes = 20L * 1024L * 1024L;
        private int maxRawResultJsonBytes = 2 * 1024 * 1024;
        private int uploadRetentionDays = 7;
        private long uploadCleanupIntervalMs = 60L * 60L * 1000L;
        private int batchStatusMaxIds = 100;
        private String modelVersion = "default";
        private String pipelineVersion = "v1";

        public int getQueueCapacity() {
            return queueCapacity;
        }

        public void setQueueCapacity(int queueCapacity) {
            this.queueCapacity = queueCapacity;
        }

        public String getQueueProvider() {
            return queueProvider;
        }

        public void setQueueProvider(String queueProvider) {
            this.queueProvider = queueProvider;
        }

        public int getDatabaseQueueCapacity() {
            return databaseQueueCapacity;
        }

        public void setDatabaseQueueCapacity(int databaseQueueCapacity) {
            this.databaseQueueCapacity = databaseQueueCapacity;
        }

        public long getDatabaseQueuePollIntervalMs() {
            return databaseQueuePollIntervalMs;
        }

        public void setDatabaseQueuePollIntervalMs(long databaseQueuePollIntervalMs) {
            this.databaseQueuePollIntervalMs = databaseQueuePollIntervalMs;
        }

        public int getRecoveryPageSize() {
            return recoveryPageSize;
        }

        public void setRecoveryPageSize(int recoveryPageSize) {
            this.recoveryPageSize = recoveryPageSize;
        }

        public int getWorkerCount() {
            return workerCount;
        }

        public void setWorkerCount(int workerCount) {
            this.workerCount = workerCount;
        }

        public int getAiRetryCount() {
            return aiRetryCount;
        }

        public void setAiRetryCount(int aiRetryCount) {
            this.aiRetryCount = aiRetryCount;
        }

        public long getAiRetryDelayMs() {
            return aiRetryDelayMs;
        }

        public void setAiRetryDelayMs(long aiRetryDelayMs) {
            this.aiRetryDelayMs = aiRetryDelayMs;
        }

        public long getAiRetryMaxDelayMs() {
            return aiRetryMaxDelayMs;
        }

        public void setAiRetryMaxDelayMs(long aiRetryMaxDelayMs) {
            this.aiRetryMaxDelayMs = aiRetryMaxDelayMs;
        }

        public long getAiRetryTotalTimeoutMs() {
            return aiRetryTotalTimeoutMs;
        }

        public void setAiRetryTotalTimeoutMs(long aiRetryTotalTimeoutMs) {
            this.aiRetryTotalTimeoutMs = aiRetryTotalTimeoutMs;
        }

        public int getAiRetryJitterPercent() {
            return aiRetryJitterPercent;
        }

        public void setAiRetryJitterPercent(int aiRetryJitterPercent) {
            this.aiRetryJitterPercent = aiRetryJitterPercent;
        }

        public int getAiBulkheadConcurrentCalls() {
            return aiBulkheadConcurrentCalls;
        }

        public void setAiBulkheadConcurrentCalls(int aiBulkheadConcurrentCalls) {
            this.aiBulkheadConcurrentCalls = aiBulkheadConcurrentCalls;
        }

        public long getAiBulkheadWaitMs() {
            return aiBulkheadWaitMs;
        }

        public void setAiBulkheadWaitMs(long aiBulkheadWaitMs) {
            this.aiBulkheadWaitMs = aiBulkheadWaitMs;
        }

        public int getAiCircuitFailureThreshold() {
            return aiCircuitFailureThreshold;
        }

        public void setAiCircuitFailureThreshold(int aiCircuitFailureThreshold) {
            this.aiCircuitFailureThreshold = aiCircuitFailureThreshold;
        }

        public long getAiCircuitOpenMs() {
            return aiCircuitOpenMs;
        }

        public void setAiCircuitOpenMs(long aiCircuitOpenMs) {
            this.aiCircuitOpenMs = aiCircuitOpenMs;
        }

        public long getMaxFileSizeBytes() {
            return maxFileSizeBytes;
        }

        public void setMaxFileSizeBytes(long maxFileSizeBytes) {
            this.maxFileSizeBytes = maxFileSizeBytes;
        }

        public int getMaxRawResultJsonBytes() {
            return maxRawResultJsonBytes;
        }

        public void setMaxRawResultJsonBytes(int maxRawResultJsonBytes) {
            this.maxRawResultJsonBytes = maxRawResultJsonBytes;
        }

        public int getUploadRetentionDays() {
            return uploadRetentionDays;
        }

        public void setUploadRetentionDays(int uploadRetentionDays) {
            this.uploadRetentionDays = uploadRetentionDays;
        }

        public long getUploadCleanupIntervalMs() {
            return uploadCleanupIntervalMs;
        }

        public void setUploadCleanupIntervalMs(long uploadCleanupIntervalMs) {
            this.uploadCleanupIntervalMs = uploadCleanupIntervalMs;
        }

        public int getBatchStatusMaxIds() {
            return batchStatusMaxIds;
        }

        public void setBatchStatusMaxIds(int batchStatusMaxIds) {
            this.batchStatusMaxIds = batchStatusMaxIds;
        }

        public String getModelVersion() {
            return modelVersion;
        }

        public void setModelVersion(String modelVersion) {
            this.modelVersion = modelVersion;
        }

        public String getPipelineVersion() {
            return pipelineVersion;
        }

        public void setPipelineVersion(String pipelineVersion) {
            this.pipelineVersion = pipelineVersion;
        }
    }
}
