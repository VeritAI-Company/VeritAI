package com.example.backend_spring.Controller;

import com.example.backend_spring.Dto.DetectionResponseDto;
import com.example.backend_spring.Entity.DetectionRequestEntity;
import com.example.backend_spring.Repository.DetectionRequestRepository;
import com.example.backend_spring.Repository.DetectionResultRepository;
import com.example.backend_spring.Config.AppProperties;
import com.example.backend_spring.Service.DetectionProcessingService;
import com.example.backend_spring.Service.DetectionUploadService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DetectionControllerTest {

    @TempDir
    Path uploadDir;

    @Test
    void createDetectionQueuesValidImageWithoutChangingResponseContract() {
        DetectionRequestRepository requestRepository = mock(DetectionRequestRepository.class);
        DetectionResultRepository resultRepository = mock(DetectionResultRepository.class);
        DetectionProcessingService processingService = mock(DetectionProcessingService.class);

        when(processingService.normalizeAnalysisMode("face_crop_only")).thenReturn("face_crop_only");
        when(processingService.recommendedPollDelayMs()).thenReturn(1000);
        when(requestRepository.findFirstByFileHashAndAnalysisModeAndDedupKeyIsNullAndStatusInOrderByCreatedAtDesc(
                any(), eq("face_crop_only"), anyCollection()
        )).thenReturn(Optional.empty());
        when(requestRepository.saveAndFlush(any(DetectionRequestEntity.class))).thenAnswer(invocation -> {
            DetectionRequestEntity entity = invocation.getArgument(0);
            ReflectionTestUtils.setField(entity, "id", 42L);
            return entity;
        });

        DetectionController controller = new DetectionController(
                requestRepository,
                resultRepository,
                processingService,
                uploadService(),
                new ObjectMapper(),
                new AppProperties()
        );

        MockMultipartFile file = new MockMultipartFile(
                "file",
                "capture.png",
                "image/png",
                new byte[] {
                        (byte) 0x89, 0x50, 0x4E, 0x47,
                        0x0D, 0x0A, 0x1A, 0x0A,
                        0x00, 0x00, 0x00, 0x0D
                }
        );

        ResponseEntity<?> response = controller.createDetection(
                file,
                "https://example.com/post",
                "image",
                "chrome-extension",
                "face_crop_only"
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(response.getBody()).isInstanceOf(DetectionResponseDto.class);
        DetectionResponseDto body = (DetectionResponseDto) response.getBody();
        assertThat(body.getRequestId()).isEqualTo(42L);
        assertThat(body.getStatus()).isEqualTo(DetectionProcessingService.STATUS_QUEUED);
        assertThat(body.getMessage()).isEqualTo("Analysis request queued.");
        assertThat(body.getResult()).isNull();
        assertThat(body.getRetryAfterMs()).isEqualTo(1000);
        assertThat(new ObjectMapper().convertValue(body, Map.class).keySet())
                .containsExactlyInAnyOrder("requestId", "status", "message", "result", "retryAfterMs");

        ArgumentCaptor<DetectionRequestEntity> requestCaptor = ArgumentCaptor.forClass(DetectionRequestEntity.class);
        verify(requestRepository).saveAndFlush(requestCaptor.capture());
        DetectionRequestEntity saved = requestCaptor.getValue();
        assertThat(saved.getFileHash()).isNotBlank();
        assertThat(saved.getDedupKey()).hasSize(64);
        assertThat(saved.getModelVersion()).isEqualTo("default");
        assertThat(saved.getPipelineVersion()).isEqualTo("v1");
        assertThat(saved.getAnalysisMode()).isEqualTo("face_crop_only");
        assertThat(saved.getStatus()).isEqualTo(DetectionProcessingService.STATUS_QUEUED);

        verify(processingService).enqueue(eq(42L), any(Path.class), eq("face_crop_only"));
    }

    @Test
    void createDetectionReusesPendingDuplicateWithoutCreatingNewRequest() {
        DetectionRequestRepository requestRepository = mock(DetectionRequestRepository.class);
        DetectionResultRepository resultRepository = mock(DetectionResultRepository.class);
        DetectionProcessingService processingService = mock(DetectionProcessingService.class);

        DetectionRequestEntity existing = new DetectionRequestEntity();
        ReflectionTestUtils.setField(existing, "id", 10L);
        existing.setStatus(DetectionProcessingService.STATUS_QUEUED);
        existing.setAnalysisMode("face_crop_only");

        when(processingService.normalizeAnalysisMode("face_crop_only")).thenReturn("face_crop_only");
        when(processingService.recommendedPollDelayMs()).thenReturn(1000);
        when(requestRepository.findFirstByFileHashAndAnalysisModeAndDedupKeyIsNullAndStatusInOrderByCreatedAtDesc(
                any(), eq("face_crop_only"), anyCollection()
        )).thenReturn(Optional.of(existing));
        when(resultRepository.findByRequestId(10L)).thenReturn(Optional.empty());

        DetectionController controller = new DetectionController(
                requestRepository,
                resultRepository,
                processingService,
                uploadService(),
                new ObjectMapper(),
                new AppProperties()
        );

        ResponseEntity<?> response = controller.createDetection(
                pngFile(),
                "https://example.com/post",
                "image",
                "chrome-extension",
                "face_crop_only"
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        DetectionResponseDto body = (DetectionResponseDto) response.getBody();
        assertThat(body.getRequestId()).isEqualTo(10L);
        assertThat(body.getStatus()).isEqualTo(DetectionProcessingService.STATUS_QUEUED);
        assertThat(body.getMessage()).isEqualTo("Duplicate analysis already queued.");

        verify(requestRepository, never()).save(any());
        verify(requestRepository, never()).saveAndFlush(any());
        verify(processingService, never()).enqueue(any(), any(), any());
    }

    @Test
    void createDetectionReturnsTooManyRequestsWhenQueueIsFull() {
        DetectionRequestRepository requestRepository = mock(DetectionRequestRepository.class);
        DetectionResultRepository resultRepository = mock(DetectionResultRepository.class);
        DetectionProcessingService processingService = mock(DetectionProcessingService.class);

        when(processingService.normalizeAnalysisMode("face_crop_only")).thenReturn("face_crop_only");
        when(processingService.recommendedPollDelayMs()).thenReturn(5000);
        when(requestRepository.findFirstByFileHashAndAnalysisModeAndDedupKeyIsNullAndStatusInOrderByCreatedAtDesc(
                any(), eq("face_crop_only"), anyCollection()
        )).thenReturn(Optional.empty());
        when(requestRepository.saveAndFlush(any(DetectionRequestEntity.class))).thenAnswer(invocation -> {
            DetectionRequestEntity entity = invocation.getArgument(0);
            ReflectionTestUtils.setField(entity, "id", 43L);
            return entity;
        });
        doThrow(new DetectionProcessingService.QueueFullException("full"))
                .when(processingService)
                .enqueue(eq(43L), any(Path.class), eq("face_crop_only"));

        DetectionController controller = new DetectionController(
                requestRepository,
                resultRepository,
                processingService,
                uploadService(),
                new ObjectMapper(),
                new AppProperties()
        );

        ResponseEntity<?> response = controller.createDetection(
                pngFile(),
                "https://example.com/post",
                "image",
                "chrome-extension",
                "face_crop_only"
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(response.getHeaders().getFirst("Retry-After")).isEqualTo("5");
        DetectionResponseDto body = (DetectionResponseDto) response.getBody();
        assertThat(body.getRequestId()).isEqualTo(43L);
        assertThat(body.getStatus()).isEqualTo(DetectionProcessingService.STATUS_FAILED);
        assertThat(body.getMessage()).isEqualTo("Detection queue is full. Please retry later.");
        assertThat(body.getRetryAfterMs()).isEqualTo(5000);

        verify(requestRepository).saveAndFlush(any(DetectionRequestEntity.class));
        verify(requestRepository).save(any(DetectionRequestEntity.class));
    }

    @Test
    void createDetectionRejectsNonImageWithStandardErrorBody() {
        DetectionRequestRepository requestRepository = mock(DetectionRequestRepository.class);
        DetectionResultRepository resultRepository = mock(DetectionResultRepository.class);
        DetectionProcessingService processingService = mock(DetectionProcessingService.class);

        DetectionController controller = new DetectionController(
                requestRepository,
                resultRepository,
                processingService,
                uploadService(),
                new ObjectMapper(),
                new AppProperties()
        );

        MockMultipartFile file = new MockMultipartFile(
                "file",
                "capture.txt",
                "text/plain",
                "not an image".getBytes()
        );

        ResponseEntity<?> response = controller.createDetection(
                file,
                "https://example.com/post",
                "image",
                "chrome-extension",
                "face_crop_only"
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).isInstanceOf(DetectionResponseDto.class);
        DetectionResponseDto body = (DetectionResponseDto) response.getBody();
        assertThat(body.getRequestId()).isNull();
        assertThat(body.getStatus()).isEqualTo(DetectionProcessingService.STATUS_FAILED);
        assertThat(body.getMessage()).isEqualTo("Uploaded file must be a supported image.");
        assertThat(body.getResult()).isNull();

        verify(requestRepository, never()).save(any());
        verify(requestRepository, never()).saveAndFlush(any());
        verify(processingService, never()).enqueue(any(), any(), any());
    }

    @Test
    @SuppressWarnings("unchecked")
    void getDetectionStatusesUsesBatchLookupAndPreservesRequestedOrder() {
        DetectionRequestRepository requestRepository = mock(DetectionRequestRepository.class);
        DetectionResultRepository resultRepository = mock(DetectionResultRepository.class);
        DetectionProcessingService processingService = mock(DetectionProcessingService.class);
        when(processingService.recommendedPollDelayMs()).thenReturn(1000);
        when(processingService.getQueueMetrics()).thenReturn(Map.of("queuedCount", 0));

        DetectionRequestEntity first = new DetectionRequestEntity();
        ReflectionTestUtils.setField(first, "id", 1L);
        first.setStatus(DetectionProcessingService.STATUS_QUEUED);

        DetectionRequestEntity second = new DetectionRequestEntity();
        ReflectionTestUtils.setField(second, "id", 2L);
        second.setStatus(DetectionProcessingService.STATUS_FAILED);
        second.setFailureMessage("AI server connection or timeout failure: timeout");

        when(requestRepository.findAllById(anyCollection())).thenReturn(List.of(second, first));
        when(resultRepository.findByRequestIdIn(anyCollection())).thenReturn(List.of());

        DetectionController controller = new DetectionController(
                requestRepository,
                resultRepository,
                processingService,
                uploadService(),
                new ObjectMapper(),
                new AppProperties()
        );

        ResponseEntity<?> response = controller.getDetectionStatuses(List.of(1L, 99L, 2L));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> payload = (Map<String, Object>) response.getBody();
        List<DetectionResponseDto> items = (List<DetectionResponseDto>) payload.get("items");
        assertThat(items).hasSize(2);
        assertThat(items.get(0).getRequestId()).isEqualTo(1L);
        assertThat(items.get(0).getStatus()).isEqualTo(DetectionProcessingService.STATUS_QUEUED);
        assertThat(items.get(1).getRequestId()).isEqualTo(2L);
        assertThat(items.get(1).getMessage()).isEqualTo("AI server connection or timeout failure: timeout");

        verify(requestRepository).findAllById(anyCollection());
        verify(requestRepository, never()).findById(any());
        verify(resultRepository).findByRequestIdIn(anyCollection());
        verify(resultRepository, never()).findByRequestId(any());
    }

    private MockMultipartFile pngFile() {
        return new MockMultipartFile(
                "file",
                "capture.png",
                "image/png",
                new byte[] {
                        (byte) 0x89, 0x50, 0x4E, 0x47,
                        0x0D, 0x0A, 0x1A, 0x0A,
                        0x00, 0x00, 0x00, 0x0D
                }
        );
    }

    private DetectionUploadService uploadService() {
        AppProperties properties = new AppProperties();
        properties.setUploadDir(uploadDir.toString());
        return new DetectionUploadService(properties);
    }
}
