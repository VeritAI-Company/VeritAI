package com.example.backend_spring.Service;

import com.example.backend_spring.Config.AppProperties;
import com.example.backend_spring.Entity.DetectionRequestEntity;
import com.example.backend_spring.Repository.DetectionRequestRepository;
import com.example.backend_spring.Repository.DetectionResultRepository;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DetectionDeletionServiceTest {

    private static final String OWNER_TOKEN = "0123456789abcdef0123456789abcdef";

    @Test
    void deletesCompletedRequestAndResultInOneBatch() {
        DetectionRequestRepository requestRepository = mock(DetectionRequestRepository.class);
        DetectionResultRepository resultRepository = mock(DetectionResultRepository.class);
        DetectionRequestEntity request = completedRequest(7L, OWNER_TOKEN);
        when(requestRepository.findAllByIdInForUpdate(anyCollection())).thenReturn(List.of(request));
        when(resultRepository.deleteByRequestIdIn(anyCollection())).thenReturn(1L);

        DetectionDeletionService service = new DetectionDeletionService(
                requestRepository,
                resultRepository,
                new AppProperties()
        );

        DetectionDeletionService.DeletionBatch result = service.delete(List.of(7L), OWNER_TOKEN);

        assertThat(result.deletedRequestCount()).isEqualTo(1);
        assertThat(result.deletedResultCount()).isEqualTo(1);
        assertThat(result.filePaths()).containsExactly("uploads/7.png");
        InOrder deletionOrder = inOrder(resultRepository, requestRepository);
        deletionOrder.verify(resultRepository).deleteByRequestIdIn(anyCollection());
        deletionOrder.verify(resultRepository).flush();
        deletionOrder.verify(requestRepository).deleteAllInBatch(List.of(request));
    }

    @Test
    void blocksQueuedOrProcessingRequestsBeforeDeletingAnything() {
        DetectionRequestRepository requestRepository = mock(DetectionRequestRepository.class);
        DetectionResultRepository resultRepository = mock(DetectionResultRepository.class);
        DetectionRequestEntity request = completedRequest(8L, OWNER_TOKEN);
        request.setStatus(DetectionStatus.PROCESSING.value());
        when(requestRepository.findAllByIdInForUpdate(anyCollection())).thenReturn(List.of(request));

        DetectionDeletionService service = new DetectionDeletionService(
                requestRepository,
                resultRepository,
                new AppProperties()
        );

        assertThatThrownBy(() -> service.delete(List.of(8L), OWNER_TOKEN))
                .isInstanceOf(DetectionDeletionService.DetectionInProgressException.class);
        verify(resultRepository, never()).deleteByRequestIdIn(anyCollection());
        verify(requestRepository, never()).deleteAllInBatch(anyCollection());
    }

    @Test
    void rejectsDeletionByAnotherOwner() {
        DetectionRequestRepository requestRepository = mock(DetectionRequestRepository.class);
        DetectionResultRepository resultRepository = mock(DetectionResultRepository.class);
        DetectionRequestEntity request = completedRequest(9L, OWNER_TOKEN);
        when(requestRepository.findAllByIdInForUpdate(anyCollection())).thenReturn(List.of(request));

        DetectionDeletionService service = new DetectionDeletionService(
                requestRepository,
                resultRepository,
                new AppProperties()
        );

        assertThatThrownBy(() -> service.delete(
                List.of(9L),
                "fedcba9876543210fedcba9876543210"
        )).isInstanceOf(DetectionDeletionService.DetectionOwnershipException.class);
        verify(resultRepository, never()).deleteByRequestIdIn(anyCollection());
        verify(requestRepository, never()).deleteAllInBatch(anyCollection());
    }

    @Test
    void rejectsMixedInvalidIdsBeforeReadingTheDatabase() {
        DetectionRequestRepository requestRepository = mock(DetectionRequestRepository.class);
        DetectionResultRepository resultRepository = mock(DetectionResultRepository.class);
        DetectionDeletionService service = new DetectionDeletionService(
                requestRepository,
                resultRepository,
                new AppProperties()
        );

        assertThatThrownBy(() -> service.delete(List.of(7L, 0L), OWNER_TOKEN))
                .isInstanceOf(DetectionDeletionService.InvalidDeletionRequestException.class);
        verify(requestRepository, never()).findAllByIdInForUpdate(anyCollection());
    }

    @Test
    void reportsMissingRequestWithoutDeletingExistingRows() {
        DetectionRequestRepository requestRepository = mock(DetectionRequestRepository.class);
        DetectionResultRepository resultRepository = mock(DetectionResultRepository.class);
        when(requestRepository.findAllByIdInForUpdate(anyCollection())).thenReturn(List.of());
        DetectionDeletionService service = new DetectionDeletionService(
                requestRepository,
                resultRepository,
                new AppProperties()
        );

        assertThatThrownBy(() -> service.delete(List.of(404L), OWNER_TOKEN))
                .isInstanceOf(DetectionDeletionService.DetectionNotFoundException.class);
        verify(resultRepository, never()).deleteByRequestIdIn(anyCollection());
        verify(requestRepository, never()).deleteAllInBatch(anyCollection());
    }

    @Test
    void mixedBatchWithProcessingRequestIsAtomic() {
        DetectionRequestRepository requestRepository = mock(DetectionRequestRepository.class);
        DetectionResultRepository resultRepository = mock(DetectionResultRepository.class);
        DetectionRequestEntity completed = completedRequest(10L, OWNER_TOKEN);
        DetectionRequestEntity processing = completedRequest(11L, OWNER_TOKEN);
        processing.setStatus(DetectionStatus.PROCESSING.value());
        when(requestRepository.findAllByIdInForUpdate(anyCollection()))
                .thenReturn(List.of(completed, processing));
        DetectionDeletionService service = new DetectionDeletionService(
                requestRepository,
                resultRepository,
                new AppProperties()
        );

        assertThatThrownBy(() -> service.delete(List.of(10L, 11L), OWNER_TOKEN))
                .isInstanceOf(DetectionDeletionService.DetectionInProgressException.class);
        verify(resultRepository, never()).deleteByRequestIdIn(anyCollection());
        verify(requestRepository, never()).deleteAllInBatch(anyCollection());
    }

    private DetectionRequestEntity completedRequest(Long id, String ownerToken) {
        DetectionRequestEntity request = new DetectionRequestEntity();
        ReflectionTestUtils.setField(request, "id", id);
        request.setStatus(DetectionStatus.DONE.value());
        request.setOwnerKeyHash(DetectionOwnerToken.hashRequired(ownerToken));
        request.setFilePath("uploads/" + id + ".png");
        return request;
    }
}
