package com.example.backend_spring.Controller;

import com.example.backend_spring.Dto.DeleteDetectionsRequest;
import com.example.backend_spring.Dto.DetectionDeletionResponseDto;
import com.example.backend_spring.Service.DetectionDeletionService;
import com.example.backend_spring.Service.DetectionDeletionService.DeletionBatch;
import com.example.backend_spring.Service.DetectionDeletionService.DetectionInProgressException;
import com.example.backend_spring.Service.DetectionDeletionService.DetectionNotFoundException;
import com.example.backend_spring.Service.DetectionDeletionService.DetectionOwnershipException;
import com.example.backend_spring.Service.DetectionDeletionService.InvalidDeletionRequestException;
import com.example.backend_spring.Service.DetectionOwnerToken.InvalidOwnerTokenException;
import com.example.backend_spring.Service.DetectionUploadCleanupService;
import com.example.backend_spring.Service.DetectionUploadCleanupService.FileDeletionOutcome;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/detections")
public class DetectionDeletionController {

    public static final String OWNER_TOKEN_HEADER = "X-VeritAI-Owner-Token";

    private final DetectionDeletionService detectionDeletionService;
    private final DetectionUploadCleanupService uploadCleanupService;

    public DetectionDeletionController(
            DetectionDeletionService detectionDeletionService,
            DetectionUploadCleanupService uploadCleanupService
    ) {
        this.detectionDeletionService = detectionDeletionService;
        this.uploadCleanupService = uploadCleanupService;
    }

    @DeleteMapping("/{requestId}")
    public ResponseEntity<?> deleteOne(
            @PathVariable Long requestId,
            @RequestHeader(OWNER_TOKEN_HEADER) String ownerToken
    ) {
        return delete(List.of(requestId), ownerToken);
    }

    @DeleteMapping
    public ResponseEntity<?> deleteMany(
            @RequestBody DeleteDetectionsRequest request,
            @RequestHeader(OWNER_TOKEN_HEADER) String ownerToken
    ) {
        return delete(request == null ? null : request.getRequestIds(), ownerToken);
    }

    private ResponseEntity<?> delete(List<Long> requestIds, String ownerToken) {
        try {
            int requestedCount = requestIds == null ? 0 : new java.util.LinkedHashSet<>(requestIds).size();
            DeletionBatch batch = detectionDeletionService.delete(requestIds, ownerToken);
            int deletedFiles = 0;
            int missingFiles = 0;
            int rejectedFiles = 0;
            int failedFiles = 0;
            for (String filePath : batch.filePaths()) {
                FileDeletionOutcome outcome = uploadCleanupService.deleteUploadFile(filePath);
                switch (outcome) {
                    case DELETED -> deletedFiles += 1;
                    case MISSING -> missingFiles += 1;
                    case REJECTED -> rejectedFiles += 1;
                    case FAILED -> failedFiles += 1;
                }
            }
            return ResponseEntity.ok(new DetectionDeletionResponseDto(
                    requestedCount,
                    batch.deletedRequestCount(),
                    batch.deletedResultCount(),
                    deletedFiles,
                    missingFiles,
                    rejectedFiles,
                    failedFiles
            ));
        } catch (InvalidDeletionRequestException | InvalidOwnerTokenException e) {
            return error(HttpStatus.BAD_REQUEST, e.getMessage());
        } catch (DetectionNotFoundException e) {
            return error(HttpStatus.NOT_FOUND, e.getMessage());
        } catch (DetectionOwnershipException e) {
            return error(HttpStatus.FORBIDDEN, e.getMessage());
        } catch (DetectionInProgressException e) {
            return error(HttpStatus.CONFLICT, e.getMessage());
        }
    }

    private ResponseEntity<Map<String, String>> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(Map.of(
                "status", "FAILED",
                "message", message
        ));
    }
}
