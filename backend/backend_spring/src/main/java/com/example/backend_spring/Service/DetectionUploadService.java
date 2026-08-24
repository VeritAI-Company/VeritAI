package com.example.backend_spring.Service;

import com.example.backend_spring.Config.AppProperties;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
public class DetectionUploadService {

    private static final int HEADER_READ_LIMIT = 16;
    private static final Set<String> ALLOWED_IMAGE_CONTENT_TYPES = Set.of(
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp",
            "image/gif",
            "image/bmp"
    );

    private final AppProperties appProperties;

    public DetectionUploadService(AppProperties appProperties) {
        this.appProperties = appProperties;
    }

    public UploadedDetectionFile storeValidated(MultipartFile file) {
        if (file.isEmpty()) {
            throw new InvalidUploadException("Uploaded file is empty.");
        }
        if (appProperties.getDetection().getMaxFileSizeBytes() > 0
                && file.getSize() > appProperties.getDetection().getMaxFileSizeBytes()) {
            throw new InvalidUploadException("Uploaded file exceeds the allowed size.");
        }

        Path uploadPath = Paths.get(appProperties.getUploadDir());
        Path savedPath = null;
        try {
            Files.createDirectories(uploadPath);
            String originalFileName = sanitizeFileName(file.getOriginalFilename());
            savedPath = uploadPath.resolve(UUID.randomUUID() + "_" + originalFileName);
            StoredFile storedFile = writeAndHash(file, savedPath);
            Optional<String> validationError = validateImageUpload(file, storedFile.header());
            if (validationError.isPresent()) {
                deleteQuietly(savedPath);
                throw new InvalidUploadException(validationError.get());
            }
            return new UploadedDetectionFile(
                    savedPath,
                    originalFileName,
                    storedFile.fileHash(),
                    file.getContentType(),
                    storedFile.fileSize()
            );
        } catch (InvalidUploadException e) {
            throw e;
        } catch (Exception e) {
            if (savedPath != null) {
                deleteQuietly(savedPath);
            }
            throw new UploadStorageException("Failed to store uploaded file.", e);
        }
    }

    public void deleteQuietly(Path path) {
        if (path == null) {
            return;
        }
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
        }
    }

    private StoredFile writeAndHash(MultipartFile file, Path savedPath) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] header = new byte[HEADER_READ_LIMIT];
        int headerLength = 0;
        long totalBytes = 0;
        try (InputStream rawInput = file.getInputStream();
             DigestInputStream input = new DigestInputStream(rawInput, digest);
             OutputStream output = Files.newOutputStream(
                     savedPath,
                     StandardOpenOption.CREATE_NEW,
                     StandardOpenOption.WRITE
             )) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (headerLength < header.length) {
                    int copyLength = Math.min(read, header.length - headerLength);
                    System.arraycopy(buffer, 0, header, headerLength, copyLength);
                    headerLength += copyLength;
                }
                totalBytes += read;
                if (appProperties.getDetection().getMaxFileSizeBytes() > 0
                        && totalBytes > appProperties.getDetection().getMaxFileSizeBytes()) {
                    throw new InvalidUploadException("Uploaded file exceeds the allowed size.");
                }
                output.write(buffer, 0, read);
            }
        }
        byte[] actualHeader = new byte[headerLength];
        System.arraycopy(header, 0, actualHeader, 0, headerLength);
        return new StoredFile(HexFormat.of().formatHex(digest.digest()), actualHeader, totalBytes);
    }

    private Optional<String> validateImageUpload(MultipartFile file, byte[] header) {
        String detectedType = detectImageContentType(header);
        if (detectedType == null) {
            return Optional.of("Uploaded file must be a supported image.");
        }

        String declaredType = normalizeContentType(file.getContentType());
        if (declaredType != null
                && !"application/octet-stream".equals(declaredType)
                && !ALLOWED_IMAGE_CONTENT_TYPES.contains(declaredType)) {
            return Optional.of("Uploaded file content type is not supported.");
        }

        if (declaredType != null
                && ALLOWED_IMAGE_CONTENT_TYPES.contains(declaredType)
                && !contentTypesMatch(declaredType, detectedType)) {
            return Optional.of("Uploaded file content type does not match image data.");
        }

        return Optional.empty();
    }

    private String normalizeContentType(String contentType) {
        if (contentType == null || contentType.isBlank()) {
            return null;
        }
        String normalized = contentType.toLowerCase().trim();
        int delimiterIndex = normalized.indexOf(';');
        if (delimiterIndex >= 0) {
            normalized = normalized.substring(0, delimiterIndex).trim();
        }
        return normalized;
    }

    private boolean contentTypesMatch(String declaredType, String detectedType) {
        if ("image/jpg".equals(declaredType)) {
            declaredType = "image/jpeg";
        }
        return declaredType.equals(detectedType);
    }

    private String detectImageContentType(byte[] bytes) {
        if (startsWith(bytes, new int[] {0xFF, 0xD8, 0xFF})) {
            return "image/jpeg";
        }
        if (startsWith(bytes, new int[] {0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A})) {
            return "image/png";
        }
        if (startsWith(bytes, new int[] {0x47, 0x49, 0x46, 0x38, 0x37, 0x61})
                || startsWith(bytes, new int[] {0x47, 0x49, 0x46, 0x38, 0x39, 0x61})) {
            return "image/gif";
        }
        if (startsWith(bytes, new int[] {0x42, 0x4D})) {
            return "image/bmp";
        }
        if (bytes.length >= 12
                && startsWith(bytes, new int[] {0x52, 0x49, 0x46, 0x46})
                && bytes[8] == 0x57
                && bytes[9] == 0x45
                && bytes[10] == 0x42
                && bytes[11] == 0x50) {
            return "image/webp";
        }
        return null;
    }

    private boolean startsWith(byte[] bytes, int[] prefix) {
        if (bytes.length < prefix.length) {
            return false;
        }
        for (int i = 0; i < prefix.length; i += 1) {
            if ((bytes[i] & 0xFF) != prefix[i]) {
                return false;
            }
        }
        return true;
    }

    private String sanitizeFileName(String fileName) {
        String fallback = "capture.jpg";
        if (fileName == null || fileName.isBlank()) {
            return fallback;
        }

        String normalized = Paths.get(fileName).getFileName().toString();
        String sanitized = normalized.replaceAll("[^A-Za-z0-9._-]", "_");
        return sanitized.isBlank() ? fallback : sanitized;
    }

    private record StoredFile(String fileHash, byte[] header, long fileSize) {
    }

    public static class InvalidUploadException extends RuntimeException {
        public InvalidUploadException(String message) {
            super(message);
        }
    }

    public static class UploadStorageException extends RuntimeException {
        public UploadStorageException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
