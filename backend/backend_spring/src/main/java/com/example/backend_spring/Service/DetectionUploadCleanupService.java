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
import java.util.ArrayList;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class DetectionUploadCleanupService {

    private static final Logger log = LoggerFactory.getLogger(DetectionUploadCleanupService.class);

    private final DetectionRequestRepository detectionRequestRepository;
    private final AppProperties appProperties;
    private final Set<Path> pendingDeletionRetries = ConcurrentHashMap.newKeySet();

    public DetectionUploadCleanupService(
            DetectionRequestRepository detectionRequestRepository,
            AppProperties appProperties
    ) {
        this.detectionRequestRepository = detectionRequestRepository;
        this.appProperties = appProperties;
    }

    @Scheduled(fixedDelayString = "${app.detection.upload-cleanup-interval-ms:3600000}")
    public void cleanupExpiredUploadsOnSchedule() {
        retryFailedDeletions();
        cleanupExpiredUploads();
    }

    public int retryFailedDeletions() {
        int deletedCount = 0;
        for (Path path : new ArrayList<>(pendingDeletionRetries)) {
            FileDeletionOutcome outcome = deleteUploadFile(path.toString());
            if (outcome == FileDeletionOutcome.DELETED) {
                deletedCount += 1;
            }
        }
        return deletedCount;
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
            if (deleteUploadFile(request.getFilePath()) == FileDeletionOutcome.DELETED) {
                deletedCount += 1;
            }
        }
        return deletedCount;
    }

    public FileDeletionOutcome deleteUploadFile(String rawFilePath) {
        if (rawFilePath == null || rawFilePath.isBlank()) {
            return FileDeletionOutcome.MISSING;
        }

        Path uploadRoot = Paths.get(appProperties.getUploadDir()).toAbsolutePath().normalize();
        Path filePath = Paths.get(rawFilePath).toAbsolutePath().normalize();
        if (!filePath.startsWith(uploadRoot)) {
            pendingDeletionRetries.remove(filePath);
            log.warn("Skip upload cleanup outside upload directory: {}", filePath);
            return FileDeletionOutcome.REJECTED;
        }

        try {
            if (!Files.exists(filePath)) {
                pendingDeletionRetries.remove(filePath);
                return FileDeletionOutcome.MISSING;
            }
            Path realUploadRoot = Files.exists(uploadRoot) ? uploadRoot.toRealPath() : uploadRoot;
            Path realFilePath = filePath.toRealPath();
            if (!realFilePath.startsWith(realUploadRoot)) {
                pendingDeletionRetries.remove(filePath);
                log.warn("Skip upload cleanup through path outside upload directory: {}", realFilePath);
                return FileDeletionOutcome.REJECTED;
            }
            Files.delete(realFilePath);
            pendingDeletionRetries.remove(filePath);
            return FileDeletionOutcome.DELETED;
        } catch (IOException e) {
            pendingDeletionRetries.add(filePath);
            log.warn("Failed to delete expired upload file: {}", filePath, e);
            return FileDeletionOutcome.FAILED;
        }
    }

    int pendingDeletionRetryCount() {
        return pendingDeletionRetries.size();
    }

    public enum FileDeletionOutcome {
        DELETED,
        MISSING,
        REJECTED,
        FAILED
    }
}
