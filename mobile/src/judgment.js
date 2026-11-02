// 판정 기준과 얼굴 표시 도우미
// 웹(크롬 확장, PWA)의 shared/judgment.js와 같은 값을 쓴다. 앱은 빌드 구조상 그 파일을 가져올 수 없어 여기에 같은 값을 둔다.
// 판정 기준을 바꾸면 이 파일과 shared/judgment.js를 같이 바꾼다.

export const FACE_FAKE_MIN = 0.5;      // 이 확률 이상이면 조작 의심
export const FACE_CAUTION_MIN = 0.3;   // 이 확률 이상이면 주의
export const FACE_DETECTION_MIN = 0.5; // 인식 신뢰도가 이보다 낮은 얼굴은 목록에서 처음에 접어 둔다

export function readDeepfakeFlag(result) {
    if (!result) return false;
    return Boolean(result.isDeepfake ?? result.deepfake);
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

export function faceFakeProb(face) {
    const value = face?.cnn?.fakeProbability ?? face?.fakeProbability;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function faceColor(prob, colors) {
    if (prob == null) return colors.textSub;
    if (prob >= FACE_FAKE_MIN) return colors.fake;
    if (prob >= FACE_CAUTION_MIN) return colors.warn;
    return colors.real;
}

export function selectVisibleFaces(faces, showAll) {
    const entries = faces.map((face, index) => ({ face, index }));
    if (showAll) return { visible: entries, hidden: 0 };
    let top = null;
    entries.forEach(entry => {
        const prob = faceFakeProb(entry.face);
        if (prob != null && (!top || prob > faceFakeProb(top.face))) top = entry;
    });
    const visible = entries.filter(entry => {
        const det = entry.face.detectionConfidence;
        return entry === top || typeof det !== 'number' || det >= FACE_DETECTION_MIN;
    });
    if (visible.length === 0 && entries.length > 0) visible.push(entries[0]);
    return { visible, hidden: entries.length - visible.length };
}

export const FACE_MODE_LABELS = { frontal: '정면', 'profile-left': '왼쪽 옆모습', 'profile-right': '오른쪽 옆모습', eyes_closed: '눈 감음', occluded: '가려짐' };
export const FACE_QUALITY_LABELS = { good: '좋음', usable: '보통', poor: '낮음' };
