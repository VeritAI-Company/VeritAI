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

// 결과를 화면에 쓰기 전에 형식을 확인한다. 판정 값이 참/거짓이 아니거나 확률이 숫자가 아니면 결과로 쓰지 않는다
// (값이 비어 있을 때 '정상, 0%'로 보이는 것을 막는다)
export const INVALID_RESULT_MESSAGE = '분석 결과를 읽을 수 없습니다. 다시 시도해 주세요.';
export const INVALID_RESULT_CODE = 'INVALID_RESULT';

function parseDeepfakeFlag(value) {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return null;
}

export function isValidResult(result) {
    if (!result || typeof result !== 'object') return false;
    const confidence = result.confidence;
    return parseDeepfakeFlag(result.isDeepfake ?? result.deepfake) !== null
        && confidence !== null && confidence !== '' && Number.isFinite(Number(confidence));
}

export function readDeepfakeFlag(result) {
    return parseDeepfakeFlag(result?.isDeepfake ?? result?.deepfake) === true;
}

export function clampProb(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export function getConfidence(result) {
    return clampProb(result?.confidence);
}

// 반올림하면 기준 바로 아래 값(0.4996)이 기준값(50.0%)으로 보이므로 버림으로 표시한다.
// 0.29 * 100 = 28.999... 같은 소수 오차는 아주 작은 값을 더해 막는다
export function formatPercent(value, digits = 1) {
    const scale = 10 ** digits;
    return `${(Math.floor(clampProb(value) * 100 * scale + 1e-9) / scale).toFixed(digits)}%`;
}

export function percentWidth(value) {
    return `${Math.round(clampProb(value) * 100)}%`;
}

export function getFaceFakeProb(face) {
    const value = face?.cnn?.fakeProbability ?? face?.fakeProbability;
    return typeof value === 'number' && Number.isFinite(value) ? clampProb(value) : null;
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

export function getFaceCountText(faceCount, result) {
    if (faceCount <= 0) return '얼굴을 찾지 못해 사진 전체로 검사';
    const cause = getFallbackCause(result);
    if (cause === 'low_quality') return `얼굴 ${faceCount}개를 찾았지만 모두 화질이 낮아 사진 전체로 검사`;
    if (cause === 'unreadable') return `얼굴 ${faceCount}개를 찾았지만 분석에 쓰지 못해 사진 전체로 검사`;
    return `얼굴 ${faceCount}개 검사`;
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

// 얼굴은 찾았지만 사진 전체로 판정한 이유. 서버는 화질이 낮음(poor)인 얼굴을 분석에서 빼므로, 찾은 얼굴이 모두 poor이면 화질 때문이다.
// low_quality: 모두 화질 낮음, unreadable: 그 밖의 이유(얼굴 영역을 읽지 못함 등), null: 해당 없음 (얼굴이 없거나 얼굴을 분석함)
function getFallbackCause(result) {
    if (getDecisionInfo(result).scope !== 'full_fallback') return null;
    const faces = Array.isArray(result?.faces) ? result.faces : [];
    const count = Number.isFinite(result?.faceCount) ? result.faceCount : faces.length;
    if (count <= 0) return null;
    return faces.length === count && faces.every(face => face?.quality?.label === 'poor') ? 'low_quality' : 'unreadable';
}

const FALLBACK_REASON_TEXT = {
    low_quality: '찾은 얼굴이 모두 화질이 낮아(선명도, 밝기, 대비, 얼굴 크기 등으로 평가) 분석에서 제외하고 사진 전체로 판정했습니다. 참고용이며, 선명하고 얼굴이 크게 나온 사진으로 다시 검사해 보세요.',
    unreadable: '얼굴은 찾았지만 얼굴 영역을 읽지 못해 사진 전체로 판정했습니다. 사진 전체 판정은 정확도가 낮아 참고용입니다.',
    none: '얼굴을 찾지 못해 사진 전체로 판정했습니다. 얼굴이 없는 사진은 정확도가 낮아 참고용입니다.',
};

export function getDecisionReasonText(result) {
    const info = getDecisionInfo(result);
    const pct = value => formatPercent(value ?? 0);
    const pctWhole = value => formatPercent(value ?? 0, 0); // 기준값(80%)은 설정값이라 정수로 둔다
    switch (info.reason) {
        case 'high_single_face_probability':
            return `한 얼굴에서 강한 조작 흔적이 보였습니다 (가장 높은 얼굴 ${pct(info.maxProbability)}).`;
        case 'high_average_face_probability':
            return `여러 얼굴에서 전반적으로 조작 흔적이 보였습니다 (얼굴 평균 ${pct(info.averageProbability)}).`;
        case 'below_combined_thresholds':
            if (info.maxProbability != null && info.maxProbability >= FACE_FAKE_MIN) {
                return `한 얼굴이 ${pct(info.maxProbability)}로 나왔지만 단독 기준(${pctWhole(info.highMaxThreshold)})보다 낮고, 얼굴 평균도 ${pct(info.averageProbability)}라 정상으로 판정했습니다.`;
            }
            return null;
        case 'full_image_threshold_met':
        case 'full_image_below_threshold':
            return FALLBACK_REASON_TEXT[getFallbackCause(result) ?? 'none'];
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
