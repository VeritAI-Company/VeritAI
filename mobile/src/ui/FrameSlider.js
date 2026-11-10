import { useEffect, useRef, useState } from 'react';
import { PanResponder, Text, View } from 'react-native';
import { clampFrameTime, formatTime } from '../media';
import { parseDurationMs, ratioFromTime, ratioFromX, timeFromRatio } from '../sliderMath';
import { useTheme } from './ThemeContext';

const KEY_STEP_MS = 5000;

// 검사할 영상 장면을 고르는 막대. 새 네이티브 모듈 없이 PanResponder로 만든다.
// 끄는 동안에는 시각만 바뀌고, 손을 떼면(막대를 눌러도) 그 지점의 장면을 가져온다 (웹 슬라이더와 같은 방식)
export function FrameSlider({ durationMs, valueMs, disabled, onChange }) {
    const { styles } = useTheme();
    const duration = parseDurationMs(durationMs);
    const [dragRatio, setDragRatio] = useState(null);
    const trackRef = useRef(null);
    const trackBox = useRef({ left: 0, width: 0 });
    const latest = useRef({});
    const ratioRef = useRef(0);
    latest.current = { duration, disabled, onChange, valueMs: valueMs || 0 };

    // 장면을 가져오는 동안은 놓은 자리를 보여 주고, 끝나면(성공이든 실패든) 실제 지점으로 돌아간다
    useEffect(() => {
        if (!disabled) setDragRatio(null);
    }, [disabled, valueMs]);

    const responder = useRef(PanResponder.create({
        onStartShouldSetPanResponder: () => !latest.current.disabled && Boolean(latest.current.duration),
        onMoveShouldSetPanResponder: () => !latest.current.disabled && Boolean(latest.current.duration),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
            const pageX = event.nativeEvent.pageX;
            if (trackBox.current.width > 0) moveTo(pageX); // 미리 잰 위치로 바로 반응한다 (아주 빠른 탭에서도 처음 위치가 틀리지 않게)
            measureTrack(() => moveTo(pageX));
        },
        onPanResponderMove: (_event, gesture) => moveTo(gesture.moveX),
        onPanResponderRelease: () => finish(true),
        onPanResponderTerminate: () => finish(false),
    })).current;

    // 막대의 화면 위치(왼쪽 끝, 폭). 화면 크기나 배치가 바뀌면 다시 잰다
    function measureTrack(done) {
        trackRef.current?.measureInWindow((left, _top, width) => {
            trackBox.current = { left, width };
            if (done) done();
        });
    }

    function moveTo(pageX) {
        const { left, width } = trackBox.current;
        ratioRef.current = ratioFromX(pageX - left, width);
        setDragRatio(ratioRef.current);
    }

    function finish(commit) {
        const { duration: total, onChange: change, valueMs: current } = latest.current;
        // 앱이 가져올 지점(영상 끝에서 0.1초 안쪽으로 자름)과 같게 맞춰서 비교한다
        const target = total ? clampFrameTime(timeFromRatio(ratioRef.current, total), total) : 0;
        // 같은 지점이면 장면을 다시 가져오지 않으므로 막대를 실제 지점으로 되돌린다
        if (!commit || !total || target === current) { setDragRatio(null); return; }
        change(target);
    }

    if (!duration) return null;
    const currentMs = valueMs || 0;
    const ratio = dragRatio ?? ratioFromTime(currentMs, duration);
    const shownMs = dragRatio == null ? currentMs : timeFromRatio(dragRatio, duration);
    const percent = `${ratio * 100}%`;

    return (
        <View style={[styles.slider, disabled && { opacity: 0.4 }]}>
            <View
                {...responder.panHandlers}
                style={styles.sliderTouch}
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel="검사할 장면 위치"
                accessibilityValue={{ text: `${formatTime(shownMs)} / ${formatTime(duration)}` }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={(event) => {
                    if (disabled) return;
                    const delta = event.nativeEvent.actionName === 'increment' ? KEY_STEP_MS : -KEY_STEP_MS;
                    onChange(Math.min(duration, Math.max(0, currentMs + delta)));
                }}
            >
                <View ref={trackRef} onLayout={() => measureTrack()} style={styles.sliderTrack}>
                    <View style={[styles.sliderFill, { width: percent }]} />
                    <View pointerEvents="none" style={[styles.sliderThumb, { left: percent }]} />
                </View>
            </View>
            <View style={styles.sliderLabels}>
                <Text style={styles.sliderLabel}>0:00</Text>
                <Text style={styles.sliderNow}>{formatTime(shownMs)}</Text>
                <Text style={styles.sliderLabel}>{formatTime(duration)}</Text>
            </View>
        </View>
    );
}
