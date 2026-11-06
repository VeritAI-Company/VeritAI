// 캐시 비우기: 서버의 내 검사 기록을 먼저 지우고, 성공했을 때만 메모리 캐시와 화면을 초기화한다
// 오늘의 검사 통계는 지우지 않는다 (날짜가 바뀔 때만 팝업에서 초기화)
export async function clearDetectionCacheFlow({
    getStoredRequestIds,
    deleteRecords,
    clearStoredRequestIds,
    clearMemoryCache,
    clearUi,
    reattachUi,
}) {
    const requestIds = await getStoredRequestIds();
    const deletion = await deleteRecords(requestIds);
    // 정리한 번호만 지운다 (처리 중이라 못 지운 번호는 남겨서 다음에 다시 지운다)
    await clearStoredRequestIds(deletion?.handledIds ?? requestIds);
    clearMemoryCache();
    clearUi();
    reattachUi();
    return deletion;
}

export function cacheDeletionErrorMessage(error) {
    if (error?.status === 409) {
        return "처리 중인 검사가 있어 기록을 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.";
    }
    if (error?.status === 403) {
        return "검사 기록 삭제 권한을 확인할 수 없습니다.";
    }
    return "검사 기록을 삭제하지 못했습니다.";
}
