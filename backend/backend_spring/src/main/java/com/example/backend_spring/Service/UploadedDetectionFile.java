package com.example.backend_spring.Service;

import java.nio.file.Path;

public record UploadedDetectionFile(
        Path path,
        String originalFileName,
        String fileHash,
        String mimeType,
        long fileSize
) {
}
