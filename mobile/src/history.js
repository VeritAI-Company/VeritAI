import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'veritai_history_v1';
const MAX_ITEMS = 50;

export async function loadHistory() {
    try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

export async function addHistory(entry) {
    const list = await loadHistory();
    const next = [entry, ...list.filter(item => item.requestId !== entry.requestId)].slice(0, MAX_ITEMS);
    try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
    return next;
}

export async function clearHistory() {
    try { await AsyncStorage.removeItem(STORAGE_KEY); } catch {}
    return [];
}

export function toHistoryEntry(data, { source, mediaType, frameTimeMs = null }) {
    const result = data?.result || {};
    return {
        requestId: data?.requestId,
        createdAt: new Date().toISOString(),
        isFake: Boolean(result.isDeepfake ?? result.deepfake),
        confidence: Number(result.confidence) || 0,
        faceCount: Number.isFinite(result.faceCount) ? result.faceCount : (result.faces || []).length,
        source,
        mediaType,
        frameTimeMs,
    };
}
