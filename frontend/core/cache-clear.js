export async function clearDetectionCacheFlow({
    getStoredRequestIds,
    deleteRecords,
    clearStoredRequestIds,
    clearMemoryCache,
    clearUi,
    resetStatistics,
    reattachUi,
}) {
    const requestIds = await getStoredRequestIds();
    const deletion = await deleteRecords(requestIds);
    await clearStoredRequestIds();
    clearMemoryCache();
    clearUi();
    await resetStatistics();
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
