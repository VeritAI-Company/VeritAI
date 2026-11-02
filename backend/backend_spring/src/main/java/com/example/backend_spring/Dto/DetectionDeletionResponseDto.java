package com.example.backend_spring.Dto;

public class DetectionDeletionResponseDto {

    private final int requestedCount;
    private final int deletedRequestCount;
    private final long deletedResultCount;
    private final int deletedFileCount;
    private final int missingFileCount;
    private final int rejectedFileCount;
    private final int failedFileCount;

    public DetectionDeletionResponseDto(
            int requestedCount,
            int deletedRequestCount,
            long deletedResultCount,
            int deletedFileCount,
            int missingFileCount,
            int rejectedFileCount,
            int failedFileCount
    ) {
        this.requestedCount = requestedCount;
        this.deletedRequestCount = deletedRequestCount;
        this.deletedResultCount = deletedResultCount;
        this.deletedFileCount = deletedFileCount;
        this.missingFileCount = missingFileCount;
        this.rejectedFileCount = rejectedFileCount;
        this.failedFileCount = failedFileCount;
    }

    public int getRequestedCount() {
        return requestedCount;
    }

    public int getDeletedRequestCount() {
        return deletedRequestCount;
    }

    public long getDeletedResultCount() {
        return deletedResultCount;
    }

    public int getDeletedFileCount() {
        return deletedFileCount;
    }

    public int getMissingFileCount() {
        return missingFileCount;
    }

    public int getRejectedFileCount() {
        return rejectedFileCount;
    }

    public int getFailedFileCount() {
        return failedFileCount;
    }
}
