// 판정 기준과 결과 표시 도우미
// 크롬 확장(frontend)과 PWA(portal)가 함께 쓴다. 앱(mobile)은 빌드 구조상 이 파일을 가져올 수 없어 mobile/src/judgment.js에 같은 값을 둔다.
// 판정 기준을 바꾸면 이 파일과 mobile/src/judgment.js를 같이 바꾼다.

export const FACE_FAKE_MIN = 0.5;      // 이 확률 이상이면 조작 의심 (빨강)
export const FACE_CAUTION_MIN = 0.3;   // 이 확률 이상이면 주의 (노랑)
export const FACE_DETECTION_MIN = 0.5; // 인식 신뢰도가 이보다 낮은 얼굴은 목록에서 처음에 접어 둔다

const JUDGMENT_COLORS = { fake: '#ef6f72', warn: '#e2a64a', real: '#52c08c', unknown: '#8b939c' };

export const NO_FACE_TEXT = '얼굴을 찾지 못해 사진 전체로 판정했습니다.';

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

// 확률 막대 색 단계 (CSS 클래스 이름). 확률이 없으면 빈 문자열
export function getProbLevel(prob) {
    if (prob == null) return '';
    return prob >= FACE_FAKE_MIN ? 'is-fake' : prob >= FACE_CAUTION_MIN ? 'is-warn' : 'is-real';
}

// 판정 아래 한 줄 설명
export function getVerdictDescription(isFake, confidence) {
    if (isFake) return '조작되었을 가능성이 높습니다.';
    return confidence >= FACE_CAUTION_MIN ? '조작 흔적이 약하게 보이지만 기준보다 낮습니다.' : '조작 흔적을 찾지 못했습니다.';
}

// "얼굴 N개 검사" 표시
export function getFaceCountText(faceCount) {
    return faceCount > 0 ? `얼굴 ${faceCount}개 검사` : '얼굴을 찾지 못해 사진 전체로 검사';
}

// 처음에는 인식 신뢰도가 높은 얼굴과 조작 확률이 가장 높은 얼굴만 보여 주고, 나머지는 접어 둔다
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
