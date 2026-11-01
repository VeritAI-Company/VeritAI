package com.example.backend_spring.Controller;

import com.example.backend_spring.Dto.DeleteDetectionsRequest;
import com.example.backend_spring.Dto.DetectionDeletionResponseDto;
import com.example.backend_spring.Service.DetectionDeletionService;
import com.example.backend_spring.Service.DetectionUploadCleanupService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DetectionDeletionControllerTest {

    private static final String OWNER_TOKEN = "0123456789abcdef0123456789abcdef";

    @Test
    void deleteManyReturnsDatabaseAndFileDeletionCounts() {
        DetectionDeletionService deletionService = mock(DetectionDeletionService.class);
        DetectionUploadCleanupService cleanupService = mock(DetectionUploadCleanupService.class);
        when(deletionService.delete(List.of(1L, 2L), OWNER_TOKEN)).thenReturn(
                new DetectionDeletionService.DeletionBatch(2, 2L, List.of("uploads/1.png", "uploads/2.png"))
        );
        when(cleanupService.deleteUploadFile("uploads/1.png")).thenReturn(
                DetectionUploadCleanupService.FileDeletionOutcome.DELETED
        );
        when(cleanupService.deleteUploadFile("uploads/2.png")).thenReturn(
                DetectionUploadCleanupService.FileDeletionOutcome.MISSING
        );
        DetectionDeletionController controller = new DetectionDeletionController(deletionService, cleanupService);
        DeleteDetectionsRequest request = new DeleteDetectionsRequest();
        request.setRequestIds(List.of(1L, 2L));

        ResponseEntity<?> response = controller.deleteMany(request, OWNER_TOKEN);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        DetectionDeletionResponseDto body = (DetectionDeletionResponseDto) response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.getRequestedCount()).isEqualTo(2);
        assertThat(body.getDeletedRequestCount()).isEqualTo(2);
        assertThat(body.getDeletedResultCount()).isEqualTo(2);
        assertThat(body.getDeletedFileCount()).isEqualTo(1);
        assertThat(body.getMissingFileCount()).isEqualTo(1);
        verify(deletionService).delete(List.of(1L, 2L), OWNER_TOKEN);
    }

    @Test
    void deleteOneReturnsConflictWhileDetectionIsRunning() {
        DetectionDeletionService deletionService = mock(DetectionDeletionService.class);
        DetectionUploadCleanupService cleanupService = mock(DetectionUploadCleanupService.class);
        when(deletionService.delete(List.of(9L), OWNER_TOKEN)).thenThrow(
                new DetectionDeletionService.DetectionInProgressException("Detection request 9 is still being processed.")
        );
        DetectionDeletionController controller = new DetectionDeletionController(deletionService, cleanupService);

        ResponseEntity<?> response = controller.deleteOne(9L, OWNER_TOKEN);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(response.getBody()).isInstanceOf(Map.class);
        assertThat(((Map<?, ?>) response.getBody()).get("status")).isEqualTo("FAILED");
    }
}
