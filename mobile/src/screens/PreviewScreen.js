import { View, Text, Image, ActivityIndicator, Pressable } from 'react-native';
import { useTheme } from '../ui/ThemeContext';
import { formatTime } from '../media';
import { Button } from '../ui/common';
import { FrameSlider } from '../ui/FrameSlider';

export function PreviewScreen({ media, source, frameBusy, frameError, onChangeFrame, onInspect, onCancel }) {
    const { colors, styles } = useTheme();
    const aspectRatio = media.width && media.height ? media.width / media.height : 1;
    const isVideo = media.mediaType === 'video_frame';
    const canPickFrame = isVideo && Boolean(media.sourceUri);
    return (
        <View style={styles.gap}>
            <View style={styles.card}>
                {source === 'share' && <Text style={styles.badgeInfo}>공유받은 파일</Text>}
                {isVideo && (
                    <Text style={styles.badgeInfo}>
                        영상 {formatTime(media.frameTimeMs)} 지점{media.durationMs ? ` / ${formatTime(media.durationMs)}` : ''}
                    </Text>
                )}
                <View>
                    <Image source={{ uri: media.uri }} style={[styles.preview, { aspectRatio }]} resizeMode="contain" />
                    {frameBusy && (
                        <View style={styles.frameOverlay}>
                            <ActivityIndicator color={colors.text} />
                            <Text style={styles.frameOverlayText}>장면 불러오는 중...</Text>
                        </View>
                    )}
                </View>
                {canPickFrame && (
                    <FramePicker media={media} disabled={frameBusy} onChange={onChangeFrame} />
                )}
                {!!frameError && <Text style={styles.frameError}>{frameError}</Text>}
            </View>
            <Button label={isVideo ? '이 장면 검사하기' : '검사하기'} onPress={onInspect} disabled={frameBusy} />
            <Button label={isVideo ? '다른 영상·사진 선택' : '다른 사진 선택'} onPress={onCancel} variant="ghost" />
        </View>
    );
}

function FramePicker({ media, disabled, onChange }) {
    const { colors, styles } = useTheme();
    const current = media.frameTimeMs || 0;
    const steps = [
        { label: '-5초', delta: -5000 },
        { label: '-1초', delta: -1000 },
        { label: '+1초', delta: 1000 },
        { label: '+5초', delta: 5000 },
    ];
    const marks = media.durationMs ? [
        { label: '처음', time: 0 },
        { label: '1/4', time: media.durationMs * 0.25 },
        { label: '절반', time: media.durationMs * 0.5 },
        { label: '3/4', time: media.durationMs * 0.75 },
    ] : [];
    return (
        <View style={styles.framePicker}>
            <Text style={styles.frameHint}>검사할 장면을 고르세요</Text>
            <FrameSlider durationMs={media.durationMs} valueMs={current} disabled={disabled} onChange={onChange} />
            <View style={styles.frameRow}>
                {steps.map(step => (
                    <FrameButton key={step.label} label={step.label} disabled={disabled} onPress={() => onChange(current + step.delta)} />
                ))}
            </View>
            {marks.length > 0 && (
                <View style={styles.frameRow}>
                    {marks.map(mark => (
                        <FrameButton key={mark.label} label={mark.label} disabled={disabled} onPress={() => onChange(mark.time)} />
                    ))}
                </View>
            )}
        </View>
    );
}

function FrameButton({ label, onPress, disabled }) {
    const { colors, styles } = useTheme();
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            style={({ pressed }) => [styles.frameBtn, pressed && { opacity: 0.7 }, disabled && { opacity: 0.4 }]}
        >
            <Text style={styles.frameBtnText}>{label}</Text>
        </Pressable>
    );
}
