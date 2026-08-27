package com.example.backend_spring.Service;

import com.example.backend_spring.Config.AppProperties;
import com.example.backend_spring.Entity.DetectionRequestEntity;
import com.example.backend_spring.Repository.DetectionRequestRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DetectionUploadCleanupServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void cleanupDeletesOnlyExpiredTerminalUploadFiles() throws Exception {
        Path uploadDir = tempDir.resolve("uploads");
        Files.createDirectories(uploadDir);
        Path expiredFile = uploadDir.resolve("expired.png");
        Files.write(expiredFile, new byte[] {
                (byte) 0x89, 0x50, 0x4E, 0x47,
                0x0D, 0x0A, 0x1A, 0x0A
        });

        DetectionRequestEntity expiredRequest = new DetectionRequestEntity();
        expiredRequest.setStatus(DetectionStatus.DONE.value());
        expiredRequest.setFilePath(expiredFile.toString());
        ReflectionTestUtils.setField(expiredRequest, "updatedAt", LocalDateTime.now().minusDays(8));

        DetectionRequestRepository repository = mock(DetectionRequestRepository.class);
        when(repository.findByStatusInAndUpdatedAtBefore(any(Collection.class), any(LocalDateTime.class)))
                .thenReturn(List.of(expiredRequest));

        DetectionUploadCleanupService cleanupService = new DetectionUploadCleanupService(
                repository,
                properties(uploadDir)
        );

        int deletedCount = cleanupService.cleanupExpiredUploads();

        assertThat(deletedCount).isEqualTo(1);
        assertThat(expiredFile).doesNotExist();
        verify(repository).findByStatusInAndUpdatedAtBefore(any(Collection.class), any(LocalDateTime.class));
    }

    @Test
    void cleanupSkipsFilesOutsideUploadDirectory() throws Exception {
        Path uploadDir = tempDir.resolve("uploads");
        Files.createDirectories(uploadDir);
        Path outsideFile = tempDir.resolve("outside.png");
        Files.write(outsideFile, new byte[] {
                (byte) 0x89, 0x50, 0x4E, 0x47,
                0x0D, 0x0A, 0x1A, 0x0A
        });

        DetectionRequestEntity request = new DetectionRequestEntity();
        request.setStatus(DetectionStatus.DONE.value());
        request.setFilePath(outsideFile.toString());
        ReflectionTestUtils.setField(request, "updatedAt", LocalDateTime.now().minusDays(8));

        DetectionRequestRepository repository = mock(DetectionRequestRepository.class);
        when(repository.findByStatusInAndUpdatedAtBefore(any(Collection.class), any(LocalDateTime.class)))
                .thenReturn(List.of(request));

        DetectionUploadCleanupService cleanupService = new DetectionUploadCleanupService(
                repository,
                properties(uploadDir)
        );

        int deletedCount = cleanupService.cleanupExpiredUploads();

        assertThat(deletedCount).isZero();
        assertThat(outsideFile).exists();
    }

    private AppProperties properties(Path uploadDir) {
        AppProperties properties = new AppProperties();
        properties.setUploadDir(uploadDir.toString());
        properties.getDetection().setUploadRetentionDays(7);
        return properties;
    }
}
