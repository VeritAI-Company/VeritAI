package com.example.backend_spring.Service;

import com.example.backend_spring.Config.AppProperties;
import com.example.backend_spring.Entity.DetectionRequestEntity;
import com.example.backend_spring.Repository.DetectionRequestRepository;
import com.example.backend_spring.Repository.DetectionResultRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;

@Service
public class DetectionDeletionService {

    private final DetectionRequestRepository detectionRequestRepository;
    private final DetectionResultRepository detectionResultRepository;
    private final AppProperties appProperties;

    public DetectionDeletionService(
            DetectionRequestRepository detectionRequestRepository,
            DetectionResultRepository detectionResultRepository,
            AppProperties appProperties
    ) {
        this.detectionRequestRepository = detectionRequestRepository;
        this.detectionResultRepository = detectionResultRepository;
        this.appProperties = appProperties;
    }

    @Transactional
    public DeletionBatch delete(Collection<Long> rawRequestIds, String ownerToken) {
        String ownerKeyHash = DetectionOwnerToken.hashRequired(ownerToken);
        LinkedHashSet<Long> requestIds = new LinkedHashSet<>();
        if (rawRequestIds == null || rawRequestIds.isEmpty()) {
            throw new InvalidDeletionRequestException("At least one request ID is required.");
        }
        for (Long requestId : rawRequestIds) {
            if (requestId == null || requestId <= 0) {
                throw new InvalidDeletionRequestException("Every request ID must be a positive integer.");
            }
            requestIds.add(requestId);
        }
        int maxIds = Math.max(1, appProperties.getDetection().getBatchStatusMaxIds());
        if (requestIds.size() > maxIds) {
            throw new InvalidDeletionRequestException("A maximum of " + maxIds + " request IDs is allowed.");
        }

        List<DetectionRequestEntity> requests = detectionRequestRepository.findAllByIdInForUpdate(requestIds);
        if (requests.size() != requestIds.size()) {
            throw new DetectionNotFoundException("One or more detection requests were not found.");
        }
        for (DetectionRequestEntity request : requests) {
            if (!ownerKeyHash.equals(request.getOwnerKeyHash())) {
                throw new DetectionOwnershipException("Detection request ownership could not be verified.");
            }
            if (DetectionStatus.from(request.getStatus()).map(DetectionStatus::isPending).orElse(false)) {
                throw new DetectionInProgressException(
                        "Detection request " + request.getId() + " is still being processed."
                );
            }
        }

        List<String> filePaths = requests.stream().map(DetectionRequestEntity::getFilePath).toList();
        long deletedResultCount = detectionResultRepository.deleteByRequestIdIn(requestIds);
        // Force the child-row delete before the request bulk delete. This keeps
        // the ordering deterministic even when a database FK is introduced.
        detectionResultRepository.flush();
        detectionRequestRepository.deleteAllInBatch(requests);
        return new DeletionBatch(requestIds.size(), deletedResultCount, filePaths);
    }

    public record DeletionBatch(int deletedRequestCount, long deletedResultCount, List<String> filePaths) {
    }

    public static class InvalidDeletionRequestException extends IllegalArgumentException {
        public InvalidDeletionRequestException(String message) {
            super(message);
        }
    }

    public static class DetectionNotFoundException extends RuntimeException {
        public DetectionNotFoundException(String message) {
            super(message);
        }
    }

    public static class DetectionOwnershipException extends RuntimeException {
        public DetectionOwnershipException(String message) {
            super(message);
        }
    }

    public static class DetectionInProgressException extends RuntimeException {
        public DetectionInProgressException(String message) {
            super(message);
        }
    }
}
