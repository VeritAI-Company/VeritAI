import { View, Text, Pressable } from 'react-native';
import { useTheme } from '../ui/ThemeContext';
import { Button } from '../ui/common';
import { sourceLabel, formatDate } from '../format';
import { formatTime } from '../media';

export function HomeScreen({ onCamera, onGallery, history, onOpenHistory, onClearHistory, serverRecordCount = 0 }) {
    const { colors, styles } = useTheme();
    return (
        <View style={styles.gap}>
            <View style={[styles.card, styles.gap]}>
                <Text style={styles.startTitle}>검사할 사진이나 영상을 고르세요</Text>
                <Text style={styles.muted}>얼굴이 잘 보이는 사진일수록 정확합니다.</Text>
                <Button label="갤러리에서 선택" onPress={onGallery} />
                <Button label="사진 찍기" onPress={onCamera} variant="secondary" />
            </View>

            <View style={styles.tip}>
                <Text style={styles.tipText}>
                    갤러리·카카오톡 등에서 사진을 <Text style={styles.bold}>공유 → VeritAI</Text>로 보내도 바로 검사할 수 있어요.
                    인스타그램 게시물은 스크린샷을 찍어 공유해 주세요.
                </Text>
            </View>

            <View style={styles.card}>
                <View style={styles.rowBetween}>
                    <Text style={styles.sectionTitle}>최근 검사 기록</Text>
                    {(history.length > 0 || serverRecordCount > 0) && (
                        <Pressable onPress={onClearHistory} hitSlop={8}>
                            <Text style={styles.linkText}>{history.length > 0 ? '전체 삭제' : '남은 기록 지우기'}</Text>
                        </Pressable>
                    )}
                </View>
                {history.length === 0 ? (
                    <Text style={styles.muted}>
                        {serverRecordCount > 0
                            ? `서버에 아직 지우지 못한 검사 기록이 ${serverRecordCount}건 있습니다. 처리가 끝난 뒤 "남은 기록 지우기"를 눌러 주세요.`
                            : '아직 검사 기록이 없습니다.'}
                    </Text>
                ) : (
                    history.slice(0, 20).map(item => (
                        <Pressable key={`${item.requestId}-${item.createdAt}`} onPress={() => onOpenHistory(item)} style={styles.historyItem}>
                            <View style={styles.historyHead}>
                                <View style={[styles.dot, { backgroundColor: item.isFake ? colors.fake : colors.real }]} />
                                <Text style={[styles.historyVerdict, { color: item.isFake ? colors.fake : colors.real }]}>
                                    {item.isFake ? '조작 의심' : '정상'}
                                </Text>
                            </View>
                            <Text style={styles.historyMeta}>
                                조작 확률 {(item.confidence * 100).toFixed(1)}% · 얼굴 {item.faceCount}개 · {sourceLabel(item.source)}
                                {item.mediaType === 'video_frame' ? ` · 영상${item.frameTimeMs != null ? ` ${formatTime(item.frameTimeMs)}` : ''}` : ''}
                            </Text>
                            <Text style={styles.historyDate}>{formatDate(item.createdAt)}</Text>
                        </Pressable>
                    ))
                )}
            </View>
            <Text style={styles.privacy}>
                사진은 최대 1280px로 줄여 분석 서버로만 보냅니다. 기록에는 사진 없이 판정 결과만 남깁니다.
            </Text>
        </View>
    );
}
