package com.example.backend_spring.Service;

import com.example.backend_spring.Config.AppProperties;
import com.example.backend_spring.Entity.DetectionRequestEntity;
import com.example.backend_spring.Entity.DetectionResultEntity;
import com.example.backend_spring.Repository.DetectionRequestRepository;
import com.example.backend_spring.Repository.DetectionResultRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.doThrow;

@DataJpaTest(properties = "spring.jpa.hibernate.ddl-auto=create-drop")
@Import({DetectionDeletionService.class, AppProperties.class})
class DetectionDeletionIntegrationTest {

    private static final String OWNER_TOKEN = "0123456789abcdef0123456789abcdef";

    @MockitoSpyBean
    private DetectionRequestRepository requestRepository;

    @Autowired
    private DetectionResultRepository resultRepository;

    @Autowired
    private DetectionDeletionService deletionService;

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void deletionRemovesReusableRowAndAllowsNewRequestForSameImage() {
        DetectionRequestEntity original = request("same-dedup-key");
        original = requestRepository.saveAndFlush(original);
        Long originalId = original.getId();
        resultRepository.saveAndFlush(result(originalId));

        DetectionDeletionService.DeletionBatch deleted = deletionService.delete(
                List.of(originalId),
                OWNER_TOKEN
        );

        assertThat(deleted.deletedRequestCount()).isEqualTo(1);
        assertThat(deleted.deletedResultCount()).isEqualTo(1);
        assertThat(requestRepository.findById(originalId)).isEmpty();
        assertThat(resultRepository.findByRequestId(originalId)).isEmpty();

        DetectionRequestEntity repeated = request("same-dedup-key");
        repeated = requestRepository.saveAndFlush(repeated);

        assertThat(repeated.getId()).isNotEqualTo(originalId);
        assertThat(requestRepository.findFirstByDedupKeyAndStatusInOrderByCreatedAtDesc(
                "same-dedup-key",
                DetectionStatus.reusableValues()
        )).isPresent().get().extracting(DetectionRequestEntity::getId).isEqualTo(repeated.getId());
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void requestDeleteFailureRollsBackPreviouslyDeletedResult() {
        DetectionRequestEntity original = request("rollback-dedup-key");
        original = requestRepository.saveAndFlush(original);
        Long originalId = original.getId();
        resultRepository.saveAndFlush(result(originalId));
        doThrow(new IllegalStateException("forced request delete failure"))
                .when(requestRepository)
                .deleteAllInBatch(anyCollection());

        assertThatThrownBy(() -> deletionService.delete(List.of(originalId), OWNER_TOKEN))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("forced request delete failure");

        assertThat(requestRepository.findById(originalId)).isPresent();
        assertThat(resultRepository.findByRequestId(originalId)).isPresent();
    }

    private DetectionRequestEntity request(String dedupKey) {
        DetectionRequestEntity request = new DetectionRequestEntity();
        request.setStatus(DetectionStatus.DONE.value());
        request.setAnalysisMode("face_crop_only");
        request.setFileHash("same-image-hash");
        request.setDedupKey(dedupKey);
        request.setOwnerKeyHash(DetectionOwnerToken.hashRequired(OWNER_TOKEN));
        request.setFilePath("uploads/" + dedupKey + ".png");
        return request;
    }

    private DetectionResultEntity result(Long requestId) {
        DetectionResultEntity result = new DetectionResultEntity();
        result.setRequestId(requestId);
        result.setDeepfake(false);
        result.setConfidence(0.1);
        result.setFaceCount(1);
        return result;
    }
}
