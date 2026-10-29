import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator, BackHandler, Image, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { WebView } from 'react-native-webview';

import { colors as themeColors } from './src/theme';
import { PORTAL_URL } from './src/config';
import { requestDetection, fetchDetection, toFriendlyMessage, toErrorDetail } from './src/api';
import { prepareMedia, prepareVideoFrame, clampFrameTime, formatTime, toFileUri, isVideoMime } from './src/media';
import { loadHistory, addHistory, clearHistory, toHistoryEntry } from './src/history';

// 색과 스타일을 모든 화면에 나눠 준다
const ThemeContext = createContext(null);

function useTheme() {
    return useContext(ThemeContext);
}

export default function App() {
    const theme = useMemo(() => ({ colors: themeColors, styles: makeStyles(themeColors) }), []);
    return (
        <ThemeContext.Provider value={theme}>
            <SafeAreaProvider>
                <ShareIntentProvider>
                    <StatusBar style="light" />
                    <Main />
                </ShareIntentProvider>
            </SafeAreaProvider>
        </ThemeContext.Provider>
    );
}

function Main() {
    const { colors, styles } = useTheme();
    const [screen, setScreen] = useState('home');
    const [media, setMedia] = useState(null);
    const [source, setSource] = useState('gallery');
    const [data, setData] = useState(null);
    const [loadingText, setLoadingText] = useState('');
    const [error, setError] = useState({ message: '', canRetry: false, detail: '' });
    const [sharedText, setSharedText] = useState('');
    const [history, setHistory] = useState([]);
    const busyRef = useRef(false);
    const [frameBusy, setFrameBusy] = useState(false);
    const [frameError, setFrameError] = useState('');

    const { hasShareIntent, shareIntent, resetShareIntent, error: shareError } = useShareIntentContext();

    useEffect(() => { loadHistory().then(setHistory); }, []);

    const goHome = useCallback(() => {
        setScreen('home');
        setMedia(null);
        setData(null);
    }, []);

    const showError = useCallback((message, canRetry = false, detail = '') => {
        setError({ message, canRetry, detail });
        setScreen('error');
    }, []);

    const handleMediaSelected = useCallback(async ({ uri, isVideo, durationMs = null }, origin) => {
        setSource(origin);
        setData(null);
        setFrameError('');
        setLoadingText(isVideo ? '영상에서 화면을 추출하는 중...' : '사진을 준비하는 중...');
        setScreen('loading');
        try {
            const prepared = await prepareMedia({ uri, isVideo, durationMs });
            setMedia(prepared);
            setScreen('preview');
        } catch (err) {
            setMedia(null);
            showError(err.message || '사진을 불러오지 못했습니다.', false, err.detail || '');
        }
    }, [showError]);

    useEffect(() => {
        if (!hasShareIntent || !shareIntent) return;
        const file = shareIntent.files?.[0];
        if (file?.path) {
            handleMediaSelected({ uri: toFileUri(file.path), isVideo: isVideoMime(file.mimeType) }, 'share');
        } else {
            setSharedText(shareIntent.webUrl || shareIntent.text || '');
            setScreen('link');
        }
        resetShareIntent();
    }, [hasShareIntent, shareIntent, resetShareIntent, handleMediaSelected]);

    useEffect(() => {
        if (shareError) showError('공유된 파일을 받지 못했습니다. 다시 공유해 주세요.');
    }, [shareError, showError]);

    useEffect(() => {
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            if (screen === 'report') { setScreen('result'); return true; }
            if (screen === 'loading') return true;
            if (screen !== 'home') { goHome(); return true; }
            return false;
        });
        return () => sub.remove();
    }, [screen, goHome]);

    const pickFromGallery = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 1 });
        if (result.canceled || !result.assets?.length) return;
        const asset = result.assets[0];
        const isVideo = asset.type === 'video' || isVideoMime(asset.mimeType);
        const durationMs = Number(asset.duration) > 0 ? Number(asset.duration) : null;
        handleMediaSelected({ uri: asset.uri, isVideo, durationMs }, 'gallery');
    };

    const takePhoto = async () => {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
            showError('카메라 권한이 필요합니다. 설정 → 애플리케이션 → VeritAI → 권한에서 카메라를 허용해 주세요.');
            return;
        }
        const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
        if (result.canceled || !result.assets?.length) return;
        handleMediaSelected({ uri: result.assets[0].uri, isVideo: false }, 'camera');
    };

    const changeFrame = async (targetMs) => {
        if (!media?.sourceUri || frameBusy) return;
        const time = clampFrameTime(targetMs, media.durationMs);
        if (time === media.frameTimeMs) return;
        setFrameBusy(true);
        setFrameError('');
        try {
            const frame = await prepareVideoFrame({ uri: media.sourceUri, timeMs: time, durationMs: media.durationMs });
            setMedia(frame);
        } catch (err) {
            console.warn('[VeritAI] 장면 추출 실패:', time, err?.message);
            setFrameError(`${formatTime(time)} 지점의 장면을 가져오지 못했습니다.`);
        } finally {
            setFrameBusy(false);
        }
    };

    const pickOtherFrame = () => {
        setData(null);
        setFrameError('');
        setScreen('preview');
    };

    const inspect = async () => {
        if (!media || busyRef.current) return;
        busyRef.current = true;
        setLoadingText('서버로 전송하는 중...');
        setScreen('loading');
        try {
            const response = await requestDetection(media, (status) => {
                setLoadingText(status === 'PROCESSING' ? 'AI가 분석하는 중...' : '분석 대기 중...');
            });
            setData(response);
            setHistory(await addHistory(toHistoryEntry(response, { source, mediaType: media.mediaType, frameTimeMs: media.frameTimeMs ?? null })));
            setScreen('result');
        } catch (err) {
            showError(toFriendlyMessage(err), true, toErrorDetail(err));
        } finally {
            busyRef.current = false;
        }
    };

    const openHistory = async (item) => {
        setLoadingText('기록을 불러오는 중...');
        setScreen('loading');
        setMedia(null);
        try {
            const response = await fetchDetection(item.requestId);
            if (response.status !== 'DONE' || !response.result) throw new Error('아직 분석이 끝나지 않은 기록입니다.');
            setData(response);
            setScreen('result');
        } catch (err) {
            showError(err.status !== undefined ? toFriendlyMessage(err) : err.message, false, toErrorDetail(err));
        }
    };

    return (
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
            {screen === 'report' ? (
                <ReportScreen media={media} data={data} onBack={() => setScreen('result')} />
            ) : (
                <ScrollView contentContainerStyle={styles.container}>
                    <Header />
                    {screen === 'home' && (
                        <HomeScreen
                            onCamera={takePhoto}
                            onGallery={pickFromGallery}
                            history={history}
                            onOpenHistory={openHistory}
                            onClearHistory={async () => setHistory(await clearHistory())}
                        />
                    )}
                    {screen === 'preview' && media && (
                        <PreviewScreen
                            media={media}
                            source={source}
                            frameBusy={frameBusy}
                            frameError={frameError}
                            onChangeFrame={changeFrame}
                            onInspect={inspect}
                            onCancel={goHome}
                        />
                    )}
                    {screen === 'loading' && <LoadingScreen text={loadingText} />}
                    {screen === 'result' && data && (
                        <ResultScreen
                            data={data}
                            media={media}
                            hasImage={Boolean(media?.base64)}
                            onReport={() => setScreen('report')}
                            onOtherFrame={pickOtherFrame}
                            onHome={goHome}
                        />
                    )}
                    {screen === 'error' && (
                        <ErrorScreen
                            message={error.message}
                            detail={error.detail}
                            onRetry={error.canRetry && media ? inspect : null}
                            onHome={goHome}
                        />
                    )}
                    {screen === 'link' && <LinkScreen url={sharedText} onHome={goHome} />}
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

function Header() {
    const { colors, styles } = useTheme();
    return (
        <View style={styles.header}>
            <Text style={styles.title}>VeritAI</Text>
            <Text style={styles.subtitle}>사진·영상 속 얼굴의 딥페이크 조작 여부 검사</Text>
        </View>
    );
}

function Button({ label, onPress, variant = 'primary', disabled = false }) {
    const { colors, styles } = useTheme();
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            style={({ pressed }) => [
                styles.btn,
                variant === 'primary' && styles.btnPrimary,
                variant === 'secondary' && styles.btnSecondary,
                variant === 'ghost' && styles.btnGhost,
                pressed && { opacity: 0.8 },
                disabled && { opacity: 0.5 },
            ]}
        >
            <Text style={[styles.btnText, variant === 'primary' && styles.btnTextPrimary, variant === 'ghost' && styles.btnTextGhost]}>{label}</Text>
        </Pressable>
    );
}

function HomeScreen({ onCamera, onGallery, history, onOpenHistory, onClearHistory }) {
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
                    {history.length > 0 && (
                        <Pressable onPress={onClearHistory} hitSlop={8}>
                            <Text style={styles.linkText}>전체 삭제</Text>
                        </Pressable>
                    )}
                </View>
                {history.length === 0 ? (
                    <Text style={styles.muted}>아직 검사 기록이 없습니다.</Text>
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

function PreviewScreen({ media, source, frameBusy, frameError, onChangeFrame, onInspect, onCancel }) {
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

function LoadingScreen({ text }) {
    const { colors, styles } = useTheme();
    return (
        <View style={[styles.card, styles.center, styles.loadingCard]}>
            <ActivityIndicator size="large" color={colors.text} />
            <Text style={styles.loadingText}>{text}</Text>
            <Text style={styles.muted}>사진에 따라 몇 초 걸릴 수 있습니다</Text>
        </View>
    );
}

function ResultScreen({ data, media, hasImage, onReport, onOtherFrame, onHome }) {
    const { colors, styles } = useTheme();
    const result = data.result || {};
    const faces = Array.isArray(result.faces) ? result.faces : [];
    const isFake = Boolean(result.isDeepfake ?? result.deepfake);
    const confidence = Number(result.confidence) || 0;
    const percent = (confidence * 100).toFixed(1);
    const faceCount = Number.isFinite(result.faceCount) ? result.faceCount : faces.length;
    const verdictDesc = isFake
        ? '조작되었을 가능성이 높습니다.'
        : confidence >= 0.3 ? '조작 흔적이 약하게 보이지만 기준보다 낮습니다.' : '조작 흔적을 찾지 못했습니다.';
    const meta = [faceCount > 0 ? `얼굴 ${faceCount}개 검사` : '얼굴을 찾지 못해 사진 전체로 검사'];
    if (media?.mediaType === 'video_frame' && media.frameTimeMs != null) meta.push(`영상 ${formatTime(media.frameTimeMs)} 장면`);
    const [showAllFaces, setShowAllFaces] = useState(false);
    const { visible: visibleFaces, hidden: hiddenFaces } = selectVisibleFaces(faces, showAllFaces);
    const canToggleFaces = selectVisibleFaces(faces, false).hidden > 0;

    return (
        <View style={styles.gap}>
            <View style={styles.verdict} accessible accessibilityLabel={`${isFake ? '조작 의심' : '정상'}. ${verdictDesc} 조작 확률 ${percent}%`}>
                <Text style={[styles.verdictTitle, { color: isFake ? colors.fake : colors.real }]}>
                    {isFake ? '조작 의심' : '정상'}
                </Text>
                <Text style={styles.verdictDesc}>{verdictDesc}</Text>
                <View style={styles.meterRow}>
                    <Text style={styles.meterLabel}>조작 확률</Text>
                    <Text style={styles.meterValue}>{percent}%</Text>
                </View>
                <View style={styles.track}>
                    <View style={[styles.fill, { width: `${Math.round(confidence * 100)}%`, backgroundColor: faceColor(confidence, colors) }]} />
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
                            `인식 신뢰도 ${((face.detectionConfidence ?? face.score ?? 0) * 100).toFixed(0)}%`,
                            `화질 ${FACE_QUALITY_LABELS[face.quality?.label] || face.quality?.label || '-'}`,
                        ].join(' · ');
                        return (
                            <View key={i} style={[styles.faceItem, i !== visibleFaces[0].index && styles.faceItemBorder]}>
                                <View style={styles.faceRowLine}>
                                    <Text style={styles.faceName}>얼굴 {i + 1}</Text>
                                    <View style={[styles.track, styles.faceTrack]}>
                                        <View style={[styles.fill, { width: `${Math.round((prob ?? 0) * 100)}%`, backgroundColor: faceColor(prob, colors) }]} />
                                    </View>
                                    <Text style={[styles.faceProb, { color: faceColor(prob, colors) }]}>
                                        {prob != null ? `${(prob * 100).toFixed(0)}%` : '-'}
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

function ReportScreen({ media, data, onBack }) {
    const { colors, styles } = useTheme();
    const webRef = useRef(null);
    const [loadFailed, setLoadFailed] = useState(false);

    const sendReport = () => {
        if (!media?.base64 || !data) return;
        webRef.current?.postMessage(JSON.stringify({
            type: 'veritai-report',
            imageDataUrl: `data:image/jpeg;base64,${media.base64}`,
            data,
        }));
    };

    return (
        <View style={{ flex: 1 }}>
            <View style={styles.reportBar}>
                <Pressable onPress={onBack} hitSlop={10}><Text style={styles.linkText}>‹ 결과로 돌아가기</Text></Pressable>
                <Text style={styles.reportTitle}>검사 결과</Text>
                <View style={{ width: 90 }} />
            </View>
            {loadFailed ? (
                <View style={[styles.container, styles.gap]}>
                    <ErrorScreen
                        message={'웹 리포트를 열 수 없습니다.\nPC에서 포털(npm run dev:portal)이 켜져 있는지, adb reverse tcp:5173 tcp:5173 을 했는지 확인해 주세요.'}
                        onRetry={() => setLoadFailed(false)}
                        onHome={onBack}
                    />
                </View>
            ) : (
                <WebView
                    ref={webRef}
                    source={{ uri: `${PORTAL_URL}/?embed=report` }}
                    originWhitelist={['*']}
                    javaScriptEnabled
                    domStorageEnabled
                    style={{ flex: 1, backgroundColor: colors.bg }}
                    onMessage={(event) => { if (event.nativeEvent.data === 'veritai-report-ready') sendReport(); }}
                    onError={() => setLoadFailed(true)}
                    onHttpError={() => setLoadFailed(true)}
                />
            )}
        </View>
    );
}

function ErrorScreen({ message, detail, onRetry, onHome }) {
    const { colors, styles } = useTheme();
    return (
        <View style={styles.gap}>
            <View style={[styles.card, styles.center, styles.gap, styles.errorCard]}>
                <Text style={styles.errorTitle}>문제가 생겼어요</Text>
                <Text style={styles.errorText}>{message}</Text>
                {!!detail && (
                    <Text style={styles.errorDetail} selectable>자세한 원인: {detail}</Text>
                )}
            </View>
            {onRetry && <Button label="다시 시도" onPress={onRetry} />}
            <Button label="처음으로" onPress={onHome} variant="ghost" />
        </View>
    );
}

function LinkScreen({ url, onHome }) {
    const { colors, styles } = useTheme();
    return (
        <View style={styles.gap}>
            <View style={[styles.card, styles.gap]}>
                <Text style={styles.cardTitle}>링크가 공유되었습니다</Text>
                {!!url && <Text style={styles.urlText} numberOfLines={3}>{url}</Text>}
                <Text style={styles.bodyText}>
                    인스타그램 등 SNS는 공유할 때 사진 대신 게시물 링크만 보내 주기 때문에, 링크로는 아직 검사할 수 없습니다.
                </Text>
                <Text style={styles.bodyText}>
                    검사할 사진을 <Text style={styles.bold}>스크린샷</Text>으로 찍은 뒤, 스크린샷을 <Text style={styles.bold}>공유 → VeritAI</Text>로 보내 주세요.
                </Text>
            </View>
            <Button label="처음으로" onPress={onHome} />
        </View>
    );
}

function faceFakeProb(face) {
    const value = face?.cnn?.fakeProbability ?? face?.fakeProbability;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function faceColor(prob, colors) {
    if (prob == null) return colors.textSub;
    if (prob >= 0.5) return colors.fake;
    if (prob >= 0.3) return colors.warn;
    return colors.real;
}

function selectVisibleFaces(faces, showAll) {
    const entries = faces.map((face, index) => ({ face, index }));
    if (showAll) return { visible: entries, hidden: 0 };
    let top = null;
    entries.forEach(entry => {
        const prob = faceFakeProb(entry.face);
        if (prob != null && (!top || prob > faceFakeProb(top.face))) top = entry;
    });
    const visible = entries.filter(entry => {
        const det = entry.face.detectionConfidence;
        return entry === top || typeof det !== 'number' || det >= 0.5;
    });
    if (visible.length === 0 && entries.length > 0) visible.push(entries[0]);
    return { visible, hidden: entries.length - visible.length };
}

const FACE_MODE_LABELS = { frontal: '정면', 'profile-left': '왼쪽 옆모습', 'profile-right': '오른쪽 옆모습', eyes_closed: '눈 감음', occluded: '가려짐' };
const FACE_QUALITY_LABELS = { good: '좋음', usable: '보통', poor: '낮음' };

function sourceLabel(source) {
    return { share: '공유', gallery: '갤러리', camera: '카메라' }[source] || '';
}

function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeStyles(colors) {
    return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    container: { padding: 16, paddingBottom: 32 },
    gap: { gap: 12 },
    center: { alignItems: 'center' },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },

    header: { marginTop: 4, marginBottom: 18 },
    title: { fontSize: 20, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
    subtitle: { marginTop: 2, fontSize: 12, color: colors.textSub },

    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
    startTitle: { fontSize: 17, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
    cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
    sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
    bold: { fontWeight: '700', color: colors.text },
    muted: { fontSize: 13, color: colors.textSub },
    bodyText: { fontSize: 14, lineHeight: 21, color: colors.textSub },
    linkText: { fontSize: 13, color: colors.accent, fontWeight: '600' },

    btn: { alignSelf: 'stretch', minHeight: 48, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
    btnPrimary: { backgroundColor: colors.primary },
    btnSecondary: { backgroundColor: 'transparent', borderColor: colors.border },
    btnGhost: { backgroundColor: 'transparent', minHeight: 44 },
    btnText: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
    btnTextPrimary: { color: colors.onPrimary },
    btnTextGhost: { color: colors.textSub, fontWeight: '500' },

    tip: { borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12 },
    tipText: { fontSize: 13, lineHeight: 20, color: colors.textSub },

    historyItem: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
    historyHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    historyVerdict: { fontSize: 15, fontWeight: '700' },
    historyMeta: { marginTop: 2, fontSize: 13, color: colors.textSub },
    historyDate: { marginTop: 2, fontSize: 12, color: colors.textMuted },
    privacy: { fontSize: 12, lineHeight: 18, color: colors.textMuted, textAlign: 'center' },

    badgeInfo: { alignSelf: 'flex-start', marginBottom: 8, fontSize: 12, color: colors.textSub, fontWeight: '600' },
    preview: { width: '100%', borderRadius: 6, backgroundColor: '#000' },
    frameOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 6, backgroundColor: 'rgba(18,20,23,0.6)', alignItems: 'center', justifyContent: 'center', gap: 8 },
    frameOverlayText: { fontSize: 13, color: colors.text, fontWeight: '600' },
    framePicker: { marginTop: 12, gap: 8 },
    frameHint: { fontSize: 12, color: colors.textSub },
    frameRow: { flexDirection: 'row', gap: 8 },
    frameBtn: { flex: 1, minHeight: 40, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    frameBtnText: { fontSize: 14, color: colors.text, fontWeight: '600' },
    frameError: { marginTop: 8, fontSize: 12, color: colors.warn },

    loadingCard: { paddingVertical: 40, gap: 10 },
    loadingText: { marginTop: 6, fontSize: 16, fontWeight: '600', color: colors.text },

    verdict: { paddingVertical: 18, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    verdictTitle: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
    verdictDesc: { marginTop: 2, fontSize: 14, color: colors.textSub },
    meterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 14, marginBottom: 6 },
    meterLabel: { fontSize: 13, color: colors.textSub },
    meterValue: { fontSize: 15, fontWeight: '700', color: colors.text },
    track: { height: 8, borderRadius: 4, backgroundColor: colors.track, overflow: 'hidden' },
    fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4 },
    meterScale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
    scaleText: { fontSize: 11, color: colors.textMuted },
    verdictMeta: { marginTop: 10, fontSize: 13, color: colors.textMuted },
    faceList: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 4 },
    faceItem: { paddingVertical: 12 },
    faceItemBorder: { borderTopWidth: 1, borderTopColor: colors.border },
    faceRowLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    faceName: { width: 48, fontSize: 14, fontWeight: '600', color: colors.text },
    faceTrack: { flex: 1, height: 6 },
    faceProb: { width: 44, textAlign: 'right', fontSize: 14, fontWeight: '600' },
    faceInfo: { marginTop: 4, marginLeft: 60, fontSize: 12, color: colors.textMuted },
    faceToggle: { alignSelf: 'center', paddingVertical: 8 },
    requestId: { fontSize: 11, color: colors.textMuted, textAlign: 'center' },

    errorCard: { paddingVertical: 24 },
    errorTitle: { fontSize: 16, fontWeight: '700', color: colors.warn },
    errorText: { fontSize: 15, lineHeight: 23, color: colors.text, textAlign: 'center' },
    errorDetail: { fontSize: 12, lineHeight: 18, color: colors.textMuted, textAlign: 'center' },
    urlText: { fontSize: 13, color: colors.textSub },

    reportBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    reportTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
});
}
