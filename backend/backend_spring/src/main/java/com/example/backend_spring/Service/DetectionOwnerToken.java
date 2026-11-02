package com.example.backend_spring.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

public final class DetectionOwnerToken {

    private static final int MIN_LENGTH = 32;
    private static final int MAX_LENGTH = 256;

    private DetectionOwnerToken() {
    }

    public static String hashOptional(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        return hashRequired(token);
    }

    public static String hashRequired(String token) {
        if (token == null || token.length() < MIN_LENGTH || token.length() > MAX_LENGTH) {
            throw new InvalidOwnerTokenException("A valid owner token is required.");
        }
        if (!token.matches("[A-Za-z0-9_-]+")) {
            throw new InvalidOwnerTokenException("Owner token contains invalid characters.");
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available.", e);
        }
    }

    public static class InvalidOwnerTokenException extends IllegalArgumentException {
        public InvalidOwnerTokenException(String message) {
            super(message);
        }
    }
}
