package com.example.backend_spring.Service;

import com.example.backend_spring.Config.AppProperties;
import com.example.backend_spring.Entity.DetectionRequestEntity;
import com.example.backend_spring.Repository.DetectionRequestRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.Set;

@Service
public class DetectionUploadCleanupService {

    private static final Logger log = LoggerFactory.getLogger(DetectionUploadCleanupService.class);

    private final DetectionRequestRepository detectionRequestRepository;
    private final AppProperties appProperties;

    public DetectionUploadCleanupService(
            DetectionRequestRepository detectionRequestRepository,
            AppProperties appProperties
    ) {
        this.detectionRequestRepository = detectionRequestRepository;
        this.appProperties = appProperties;
    }

    @Scheduled(fixedDelayString = "${app.detection.upload-cleanup-interval-ms:3600000}")
    public void cleanupExpiredUploadsOnSchedule() {
        cleanupExpiredUploads();
    }

    public int cleanupExpiredUploads() {
        int retentionDays = appProperties.getDetection().getUploadRetentionDays();
        if (retentionDays < 0) {
            return 0;
        }

        LocalDateTime cutoff = LocalDateTime.now().minusDays(retentionDays);
        Set<String> terminalStatuses = Set.of(
                DetectionStatus.DONE.value(),
                DetectionStatus.FAILED.value()
        );
        int deletedCount = 0;
        for (DetectionRequestEntity request : detectionRequestRepository.findByStatusInAndUpdatedAtBefore(
                terminalStatuses,
                cutoff
        )) {
            if (deleteIfUploadFile(request.getFilePath())) {
                deletedCount += 1;
            }
        }
        return deletedCount;
    }

    private boolean deleteIfUploadFile(String rawFilePath) {
        if (rawFilePath == null || rawFilePath.isBlank()) {
            return false;
        }

        Path uploadRoot = Paths.get(appProperties.getUploadDir()).toAbsolutePath().normalize();
        Path filePath = Paths.get(rawFilePath).toAbsolutePath().normalize();
        if (!filePath.startsWith(uploadRoot)) {
            log.warn("Skip upload cleanup outside upload directory: {}", filePath);
            return false;
        }

        try {
            return Files.deleteIfExists(filePath);
        } catch (IOException e) {
            log.warn("Failed to delete expired upload file: {}", filePath, e);
            return false;
        }
    }
}
