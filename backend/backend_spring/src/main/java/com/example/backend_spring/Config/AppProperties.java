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
        private int readTimeoutMs = 30000;

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
        private int workerCount = 2;
        private int aiRetryCount = 1;
        private long aiRetryDelayMs = 500;
        private long maxFileSizeBytes = 20L * 1024L * 1024L;
        private int maxRawResultJsonBytes = 2 * 1024 * 1024;
        private int uploadRetentionDays = 7;
        private long uploadCleanupIntervalMs = 60L * 60L * 1000L;

        public int getQueueCapacity() {
            return queueCapacity;
        }

        public void setQueueCapacity(int queueCapacity) {
            this.queueCapacity = queueCapacity;
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
    }
}
