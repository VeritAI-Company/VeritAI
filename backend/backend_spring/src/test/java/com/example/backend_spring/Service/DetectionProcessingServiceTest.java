package com.example.backend_spring.Service;

import com.example.backend_spring.Config.AppProperties;
import com.example.backend_spring.Dto.AiPredictionDto;
import com.example.backend_spring.Entity.DetectionRequestEntity;
import com.example.backend_spring.Entity.DetectionResultEntity;
import com.example.backend_spring.Repository.DetectionRequestRepository;
import com.example.backend_spring.Repository.DetectionResultRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DetectionProcessingServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void workerPersistsAiPredictionWithoutChangingDetectionResultFields() throws Exception {
        RestTemplate restTemplate = mock(RestTemplate.class);
        DetectionRequestRepository requestRepository = mock(DetectionRequestRepository.class);
        DetectionResultRepository resultRepository = mock(DetectionResultRepository.class);
        DetectionProcessingService service = new DetectionProcessingService(
                restTemplate,
                requestRepository,
                resultRepository,
                new ObjectMapper(),
                serviceProperties()
        );

        Path imagePath = tempDir.resolve("capture.png");
        Files.write(imagePath, new byte[] {
                (byte) 0x89, 0x50, 0x4E, 0x47,
                0x0D, 0x0A, 0x1A, 0x0A
        });

        DetectionRequestEntity request = new DetectionRequestEntity();
        ReflectionTestUtils.setField(request, "id", 7L);
        request.setFilePath(imagePath.toString());
        request.setAnalysisMode("face_crop_only");
        request.setStatus(DetectionProcessingService.STATUS_QUEUED);

        AiPredictionDto aiResult = new AiPredictionDto();
        aiResult.setDeepfake(true);
        aiResult.setConfidence(0.87);
        aiResult.setFaceCount(2);
        aiResult.setWatermarkDetected(false);
        aiResult.setModelVersion("veritai-anchor-cnn-v1");
        aiResult.setProcessingTimeMs(321);
        aiResult.setMessage("face crop only: detected 2 face(s).");

        when(requestRepository.findByStatusInOrderByCreatedAtAsc(any())).thenReturn(List.of());
        when(requestRepository.findById(7L)).thenReturn(Optional.of(request));
        when(resultRepository.findByRequestId(7L)).thenReturn(Optional.empty());
        when(requestRepository.transitionStatus(
                eq(7L),
                eq(DetectionProcessingService.STATUS_PROCESSING),
                isNull(),
                any()
        )).thenReturn(1);
        when(requestRepository.transitionStatus(
                eq(7L),
                eq(DetectionProcessingService.STATUS_DONE),
                isNull(),
                any()
        )).thenReturn(1);
        when(restTemplate.exchange(
                eq("http://localhost:8000/predict"),
                eq(HttpMethod.POST),
                any(),
                eq(AiPredictionDto.class)
        )).thenReturn(ResponseEntity.ok(aiResult));

        service.startWorkers();
        try {
            service.enqueue(7L, imagePath, "face_crop_only");

            ArgumentCaptor<DetectionResultEntity> resultCaptor = ArgumentCaptor.forClass(DetectionResultEntity.class);
            verify(resultRepository, timeout(3000)).save(resultCaptor.capture());
            DetectionResultEntity saved = resultCaptor.getValue();
            assertThat(saved.getRequestId()).isEqualTo(7L);
            assertThat(saved.isDeepfake()).isTrue();
            assertThat(saved.getConfidence()).isEqualTo(0.87);
            assertThat(saved.getFaceCount()).isEqualTo(2);
            assertThat(saved.getModelVersion()).isEqualTo("veritai-anchor-cnn-v1");
            assertThat(saved.getProcessingTimeMs()).isEqualTo(321);
            assertThat(saved.getRawResultJson()).contains("\"isDeepfake\":true");

            verify(requestRepository, timeout(3000)).transitionStatus(
                    eq(7L),
                    eq(DetectionProcessingService.STATUS_DONE),
                    isNull(),
                    any()
            );
            assertThat(request.getStatus()).isEqualTo(DetectionProcessingService.STATUS_DONE);
        } finally {
            service.stopWorkers();
        }
    }

    @Test
    void workerStoresFailureMessageWhenAiServerTimesOut() throws Exception {
        RestTemplate restTemplate = mock(RestTemplate.class);
        DetectionRequestRepository requestRepository = mock(DetectionRequestRepository.class);
        DetectionResultRepository resultRepository = mock(DetectionResultRepository.class);
        DetectionProcessingService service = new DetectionProcessingService(
                restTemplate,
                requestRepository,
                resultRepository,
                new ObjectMapper(),
                serviceProperties()
        );

        Path imagePath = tempDir.resolve("timeout-capture.png");
        Files.write(imagePath, new byte[] {
                (byte) 0x89, 0x50, 0x4E, 0x47,
                0x0D, 0x0A, 0x1A, 0x0A
        });

        DetectionRequestEntity request = new DetectionRequestEntity();
        ReflectionTestUtils.setField(request, "id", 8L);
        request.setFilePath(imagePath.toString());
        request.setAnalysisMode("face_crop_only");
        request.setStatus(DetectionProcessingService.STATUS_QUEUED);

        when(requestRepository.findByStatusInOrderByCreatedAtAsc(any())).thenReturn(List.of());
        when(requestRepository.findById(8L)).thenReturn(Optional.of(request));
        when(resultRepository.findByRequestId(8L)).thenReturn(Optional.empty());
        when(requestRepository.transitionStatus(
                eq(8L),
                eq(DetectionProcessingService.STATUS_PROCESSING),
                isNull(),
                any()
        )).thenReturn(1);
        when(requestRepository.transitionStatus(
                eq(8L),
                eq(DetectionProcessingService.STATUS_FAILED),
                any(),
                any()
        )).thenReturn(1);
        when(restTemplate.exchange(
                eq("http://localhost:8000/predict"),
                eq(HttpMethod.POST),
                any(),
                eq(AiPredictionDto.class)
        )).thenThrow(new ResourceAccessException("Read timed out"));

        service.startWorkers();
        try {
            service.enqueue(8L, imagePath, "face_crop_only");

            verify(requestRepository, timeout(3000)).transitionStatus(
                    eq(8L),
                    eq(DetectionProcessingService.STATUS_FAILED),
                    any(),
                    any()
            );
            assertThat(request.getStatus()).isEqualTo(DetectionProcessingService.STATUS_FAILED);
            assertThat(request.getFailureMessage()).contains("AI server connection or timeout failure");
            assertThat(request.getFailureMessage()).contains("Read timed out");
            verify(resultRepository, never()).save(any());
        } finally {
            service.stopWorkers();
        }
    }

    @Test
    void workerSkipsAiCallWhenQueuedRequestWasAlreadyClaimed() throws Exception {
        RestTemplate restTemplate = mock(RestTemplate.class);
        DetectionRequestRepository requestRepository = mock(DetectionRequestRepository.class);
        DetectionResultRepository resultRepository = mock(DetectionResultRepository.class);
        DetectionProcessingService service = new DetectionProcessingService(
                restTemplate,
                requestRepository,
                resultRepository,
                new ObjectMapper(),
                serviceProperties()
        );

        Path imagePath = tempDir.resolve("already-claimed.png");
        Files.write(imagePath, new byte[] {
                (byte) 0x89, 0x50, 0x4E, 0x47,
                0x0D, 0x0A, 0x1A, 0x0A
        });

        when(requestRepository.findByStatusInOrderByCreatedAtAsc(any())).thenReturn(List.of());
        when(requestRepository.transitionStatus(
                eq(9L),
                eq(DetectionProcessingService.STATUS_PROCESSING),
                isNull(),
                any()
        )).thenReturn(0);
        when(resultRepository.findByRequestId(9L)).thenReturn(Optional.empty());

        service.startWorkers();
        try {
            service.enqueue(9L, imagePath, "face_crop_only");

            verify(requestRepository, timeout(3000)).transitionStatus(
                    eq(9L),
                    eq(DetectionProcessingService.STATUS_PROCESSING),
                    isNull(),
                    any()
            );
            verify(restTemplate, never()).exchange(any(), any(), any(), eq(AiPredictionDto.class));
            verify(resultRepository, never()).save(any());
        } finally {
            service.stopWorkers();
        }
    }

    private AppProperties serviceProperties() {
        AppProperties properties = new AppProperties();
        properties.setAiServerUrl("http://localhost:8000/predict");
        properties.getDetection().setQueueCapacity(10);
        properties.getDetection().setWorkerCount(1);
        properties.getDetection().setAiRetryCount(0);
        return properties;
    }
}
