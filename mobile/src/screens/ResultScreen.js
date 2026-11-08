import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme } from '../ui/ThemeContext';
import { formatTime } from '../media';
import { selectVisibleFaces, faceColor, faceFakeProb, FACE_MODE_LABELS, FACE_QUALITY_LABELS, readDeepfakeFlag, getVerdictDescription, getFaceCountText, getDecisionReasonText, NO_SCORE_TEXT, getConfidence, formatPercent, percentWidth } from '../judgment';
import { Button } from '../ui/common';

export function ResultScreen({ data, media, hasImage, onReport, onOtherFrame, onHome }) {
    const { colors, styles } = useTheme();
    const result = data.result || {};
    const faces = Array.isArray(result.faces) ? result.faces : [];
    const isFake = readDeepfakeFlag(result);
    const confidence = getConfidence(result);
    const percent = formatPercent(confidence);
    const faceCount = Number.isFinite(result.faceCount) ? result.faceCount : faces.length;
    const verdictDesc = getVerdictDescription(isFake, confidence);
    const reasonText = getDecisionReasonText(result);
    const meta = [getFaceCountText(faceCount)];
    if (media?.mediaType === 'video_frame' && media.frameTimeMs != null) meta.push(`영상 ${formatTime(media.frameTimeMs)} 장면`);
    const [showAllFaces, setShowAllFaces] = useState(false);
    const { visible: visibleFaces, hidden: hiddenFaces } = selectVisibleFaces(faces, showAllFaces);
    const canToggleFaces = selectVisibleFaces(faces, false).hidden > 0;

    return (
        <View style={styles.gap}>
            <View style={styles.verdict} accessible accessibilityLabel={`${isFake ? '조작 의심' : '정상'}. ${verdictDesc} ${reasonText || ''} 조작 확률 ${percent}`}>
                <Text style={[styles.verdictTitle, { color: isFake ? colors.fake : colors.real }]}>
                    {isFake ? '조작 의심' : '정상'}
                </Text>
                <Text style={styles.verdictDesc}>{verdictDesc}</Text>
                {!!reasonText && <Text style={styles.verdictReason}>{reasonText}</Text>}
                <View style={styles.meterRow}>
                    <Text style={styles.meterLabel}>조작 확률</Text>
                    <Text style={styles.meterValue}>{percent}</Text>
                </View>
                <View style={styles.track}>
                    <View style={[styles.fill, { width: percentWidth(confidence), backgroundColor: faceColor(confidence, colors) }]} />
                </View>
                <View style={styles.meterScale}>
                    <Text style={styles.scaleText}>0</Text>
                    <Text style={styles.scaleText}>판정 기준 50%</Text>
                    <Text style={styles.scaleText}>100</Text>
                </View>
                <Text style={styles.verdictMeta}>{meta.join(' · ')}</Text>
            </View>

            {faces.length > 0 && (
                <View style={styles.faceList}>
                    {visibleFaces.map(({ face, index: i }) => {
                        const prob = faceFakeProb(face);
                        const info = [
                            FACE_MODE_LABELS[face.faceMode] || face.faceMode || '-',
                            `인식 신뢰도 ${formatPercent(face.detectionConfidence ?? face.score ?? 0, 0)}`,
                            `화질 ${FACE_QUALITY_LABELS[face.quality?.label] || face.quality?.label || '-'}`,
                        ].join(' · ');
                        return (
                            <View key={i} style={[styles.faceItem, i !== visibleFaces[0].index && styles.faceItemBorder]}>
                                <View style={styles.faceRowLine}>
                                    <Text style={styles.faceName}>얼굴 {i + 1}</Text>
                                    <View style={[styles.track, styles.faceTrack]}>
                                        <View style={[styles.fill, { width: percentWidth(prob), backgroundColor: faceColor(prob, colors) }]} />
                                    </View>
                                    <Text style={[styles.faceProb, { color: faceColor(prob, colors) }]}>
                                        {prob != null ? formatPercent(prob, 0) : NO_SCORE_TEXT}
                                    </Text>
                                </View>
                                <Text style={styles.faceInfo}>{info}</Text>
                            </View>
                        );
                    })}
                    {canToggleFaces && (
                        <Pressable onPress={() => setShowAllFaces(v => !v)} hitSlop={8} style={styles.faceToggle}>
                            <Text style={styles.linkText}>
                                {showAllFaces ? '주요 얼굴만 보기' : `인식 신뢰도가 낮은 얼굴 ${hiddenFaces}개 더 보기`}
                            </Text>
                        </Pressable>
                    )}
                </View>
            )}

            {hasImage ? (
                <Button label="자세히 보기 (얼굴 위치·판단 근거·신고)" onPress={onReport} />
            ) : (
                <Text style={styles.muted}>기록에는 사진이 저장되지 않아 자세한 결과는 볼 수 없습니다.</Text>
            )}
            {media?.sourceUri && (
                <Button label="같은 영상의 다른 장면 검사" onPress={onOtherFrame} variant="secondary" />
            )}
            <Button label="다른 사진 검사" onPress={onHome} variant="secondary" />
            {data.requestId != null && <Text style={styles.requestId}>요청 번호 {data.requestId}</Text>}
        </View>
    );
}
