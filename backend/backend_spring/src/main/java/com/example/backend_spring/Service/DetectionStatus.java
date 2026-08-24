package com.example.backend_spring.Service;

import java.util.Optional;
import java.util.Set;

public enum DetectionStatus {
    QUEUED,
    PROCESSING,
    DONE,
    FAILED;

    public static Optional<DetectionStatus> from(String value) {
        if (value == null || value.isBlank()) {
            return Optional.empty();
        }
        try {
            return Optional.of(DetectionStatus.valueOf(value));
        } catch (IllegalArgumentException ignored) {
            return Optional.empty();
        }
    }

    public static Set<String> pendingValues() {
        return Set.of(QUEUED.value(), PROCESSING.value());
    }

    public static Set<String> reusableValues() {
        return Set.of(QUEUED.value(), PROCESSING.value(), DONE.value());
    }

    public String value() {
        return name();
    }

    public boolean isPending() {
        return this == QUEUED || this == PROCESSING;
    }
}
