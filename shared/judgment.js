// 크롬 확장(frontend)과 PWA(portal)가 함께 쓴다. 앱(mobile)은 빌드 구조상 이 파일을 가져올 수 없어 mobile/src/judgment.js에 같은 값을 둔다.
// 판정 기준을 바꾸면 이 파일과 mobile/src/judgment.js를 같이 바꾼다.

export const FACE_FAKE_MIN = 0.5;      // 이 확률 이상이면 조작 의심 (빨강)
export const FACE_CAUTION_MIN = 0.3;   // 이 확률 이상이면 주의 (노랑)
export const FACE_DETECTION_MIN = 0.5; // 인식 신뢰도가 이보다 낮은 얼굴은 목록에서 처음에 접어 둔다

const JUDGMENT_COLORS = { fake: '#ef6f72', warn: '#e2a64a', real: '#52c08c', unknown: '#8b939c' };

export const NO_FACE_TEXT = '얼굴을 찾지 못해 사진 전체로 판정했습니다.';
export const NO_SCORE_TEXT = '판정 없음'; // 얼굴은 찾았지만 그 얼굴의 조작 확률이 없을 때

export const AI_UNAVAILABLE_MESSAGE = 'AI 판정을 하지 못했습니다. 잠시 후 다시 시도해 주세요.';
export const AI_UNAVAILABLE_CODE = 'AI_UNAVAILABLE';

export function isAiUnavailable(result) {
    return result?.cnn?.modelLoaded === false;
}

export function aiUnavailableDetail(result) {
    return result?.cnn?.error ? String(result.cnn.error) : 'cnn.modelLoaded=false';
}

const FACE_MODE_LABELS = { frontal: '정면', 'profile-left': '왼쪽 옆모습', 'profile-right': '오른쪽 옆모습', eyes_closed: '눈 감음', occluded: '가려짐' };
const FACE_QUALITY_LABELS = { good: '좋음', usable: '보통', poor: '낮음' };

export function faceModeLabel(value) {
    return FACE_MODE_LABELS[value] || value || '-';
}

export function faceQualityLabel(value) {
    return FACE_QUALITY_LABELS[value] || value || '-';
}

export function formatPercent(value, digits = 1) {
    return `${((Number(value) || 0) * 100).toFixed(digits)}%`;
}

export function readDeepfakeFlag(result) {
    if (!result) return false;
    return Boolean(result.isDeepfake ?? result.deepfake);
}

export function getFaceFakeProb(face) {
    const value = face?.cnn?.fakeProbability ?? face?.fakeProbability;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getFaceColor(prob) {
    if (prob == null) return JUDGMENT_COLORS.unknown;
    if (prob >= FACE_FAKE_MIN) return JUDGMENT_COLORS.fake;
    if (prob >= FACE_CAUTION_MIN) return JUDGMENT_COLORS.warn;
    return JUDGMENT_COLORS.real;
}

export function getProbLevel(prob) {
    if (prob == null) return '';
    return prob >= FACE_FAKE_MIN ? 'is-fake' : prob >= FACE_CAUTION_MIN ? 'is-warn' : 'is-real';
}

export function getVerdictDescription(isFake, confidence) {
    if (isFake) return '조작되었을 가능성이 높습니다.';
    return confidence >= FACE_CAUTION_MIN ? '조작 흔적이 약하게 보이지만 기준보다 낮습니다.' : '조작 흔적을 찾지 못했습니다.';
}

export function getFaceCountText(faceCount) {
    return faceCount > 0 ? `얼굴 ${faceCount}개 검사` : '얼굴을 찾지 못해 사진 전체로 검사';
}

function toNumber(value) {
    const n = Number(value);
    return value == null || !Number.isFinite(n) ? null : n;
}

export function getDecisionInfo(result) {
    const cnn = result?.cnn || {};
    return {
        scope: result?.analysisScope ?? cnn.analysisScope ?? null,           // faces | full_fallback
        reason: result?.decisionReason ?? cnn.decisionReason ?? null,
        maxProbability: toNumber(result?.maxProbability ?? cnn.maxProbability),
        averageProbability: toNumber(result?.averageProbability ?? cnn.averageProbability),
        winningView: result?.winningView ?? cnn.winningView ?? null,       
        highMaxThreshold: toNumber(cnn.highMaxThreshold) ?? 0.8,          
    };
}

export function getDecisionReasonText(result) {
    const info = getDecisionInfo(result);
    const pct = value => `${Math.round((value ?? 0) * 100)}%`;
    switch (info.reason) {
        case 'high_single_face_probability':
            return `한 얼굴에서 강한 조작 흔적이 보였습니다 (가장 높은 얼굴 ${pct(info.maxProbability)}).`;
        case 'high_average_face_probability':
            return `여러 얼굴에서 전반적으로 조작 흔적이 보였습니다 (얼굴 평균 ${pct(info.averageProbability)}).`;
        case 'below_combined_thresholds':
            if (info.maxProbability != null && info.maxProbability >= FACE_FAKE_MIN) {
                return `한 얼굴이 ${pct(info.maxProbability)}로 나왔지만 단독 기준(${pct(info.highMaxThreshold)})보다 낮고, 얼굴 평균도 ${pct(info.averageProbability)}라 정상으로 판정했습니다.`;
            }
            return null;
        case 'full_image_threshold_met':
        case 'full_image_below_threshold':
            return '얼굴을 찾지 못해 사진 전체로 판정했습니다. 얼굴이 없는 사진은 정확도가 낮아 참고용입니다.';
        default:
            return null;
    }
}

export function selectVisibleFaces(faces, showAll) {
    const entries = faces.map((face, index) => ({ face, index }));
    if (showAll) return { visible: entries, hidden: 0 };
    let top = null;
    entries.forEach(entry => {
        const prob = getFaceFakeProb(entry.face);
        if (prob != null && (!top || prob > getFaceFakeProb(top.face))) top = entry;
    });
    const visible = entries.filter(entry => {
        const det = entry.face.detectionConfidence;
        return entry === top || typeof det !== 'number' || det >= FACE_DETECTION_MIN;
    });
    if (visible.length === 0 && entries.length > 0) visible.push(entries[0]);
    return { visible, hidden: entries.length - visible.length };
}
