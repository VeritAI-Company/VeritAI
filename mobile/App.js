import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator, BackHandler, Image, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { WebView } from 'react-native-webview';

import { colors } from './src/theme';
import { PORTAL_URL } from './src/config';
import { requestDetection, fetchDetection, toFriendlyMessage, toErrorDetail } from './src/api';
import { prepareMedia, prepareVideoFrame, clampFrameTime, formatTime, toFileUri, isVideoMime } from './src/media';
import { loadHistory, addHistory, clearHistory, toHistoryEntry } from './src/history';

export default function App() {
    return (
        <SafeAreaProvider>
            <ShareIntentProvider>
                <StatusBar style="light" />
                <Main />
            </ShareIntentProvider>
        </SafeAreaProvider>
    );
}

function Main() {
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
    return (
        <View style={styles.header}>
            <Text style={styles.title}>VeritAI</Text>
            <Text style={styles.subtitle}>사진·영상 속 얼굴의 딥페이크 조작 여부를 검사합니다</Text>
        </View>
    );
}

function Button({ label, onPress, variant = 'primary', disabled = false }) {
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
            <Text style={[styles.btnText, variant === 'ghost' && styles.btnTextGhost]}>{label}</Text>
        </Pressable>
    );
}

function HomeScreen({ onCamera, onGallery, history, onOpenHistory, onClearHistory }) {
    return (
        <View style={styles.gap}>
            <View style={[styles.card, styles.center, styles.gap]}>
                <Text style={styles.bigIcon}>🛡️</Text>
                <Text style={styles.cardTitle}>검사할 사진이나 영상을 선택하세요</Text>
                <Button label="📷 사진 찍기" onPress={onCamera} />
                <Button label="🖼 갤러리에서 선택 (사진·영상)" onPress={onGallery} variant="secondary" />
            </View>

            <View style={styles.tip}>
                <Text style={styles.tipText}>
                    💡 갤러리·카카오톡 등에서 사진을 <Text style={styles.bold}>공유 → VeritAI</Text>로 보내도 바로 검사할 수 있어요.
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
                            <Text style={[styles.historyVerdict, { color: item.isFake ? colors.fake : colors.real }]}>
                                {item.isFake ? '🚨 조작 의심' : '✅ 정상'}
                            </Text>
                            <Text style={styles.historyMeta}>
                                {(item.confidence * 100).toFixed(1)}% · 얼굴 {item.faceCount}명 · {sourceLabel(item.source)}
                                {item.mediaType === 'video_frame' ? ` · 영상${item.frameTimeMs != null ? ` ${formatTime(item.frameTimeMs)}` : ''}` : ''}
                            </Text>
                            <Text style={styles.historyDate}>{formatDate(item.createdAt)}</Text>
                        </Pressable>
                    ))
                )}
            </View>
            <Text style={styles.privacy}>
                사진은 최대 1280px로 줄여 분석 서버로만 전송됩니다. 기록에는 사진을 저장하지 않고 판정 결과만 남깁니다.
            </Text>
        </View>
    );
}

function PreviewScreen({ media, source, frameBusy, frameError, onChangeFrame, onInspect, onCancel }) {
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
            <Button label={isVideo ? '🔍 이 장면 검사하기' : '🔍 검사하기'} onPress={onInspect} disabled={frameBusy} />
            <Button label={isVideo ? '다른 영상·사진 선택' : '다른 사진 선택'} onPress={onCancel} variant="ghost" />
        </View>
    );
}

function FramePicker({ media, disabled, onChange }) {
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
    return (
        <View style={[styles.card, styles.center, styles.loadingCard]}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.loadingText}>{text}</Text>
            <Text style={styles.muted}>사진에 따라 수 초 정도 걸릴 수 있습니다</Text>
        </View>
    );
}

function ResultScreen({ data, media, hasImage, onReport, onOtherFrame, onHome }) {
    const result = data.result || {};
    const faces = Array.isArray(result.faces) ? result.faces : [];
    const isFake = Boolean(result.isDeepfake ?? result.deepfake);
    const percent = ((Number(result.confidence) || 0) * 100).toFixed(1);
    const faceCount = Number.isFinite(result.faceCount) ? result.faceCount : faces.length;

    return (
        <View style={styles.gap}>
            <View style={[styles.verdict, isFake ? styles.verdictFake : styles.verdictReal]}>
                <Text style={styles.verdictIcon}>{isFake ? '🚨' : '✅'}</Text>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.verdictTitle, { color: isFake ? colors.fake : colors.real }]}>
                        {isFake ? '조작 의심' : '정상'}
                    </Text>
                    <Text style={styles.muted}>조작 확률 {percent}% · 검출된 얼굴 {faceCount}명</Text>
                    {media?.mediaType === 'video_frame' && media.frameTimeMs != null && (
                        <Text style={styles.muted}>영상 {formatTime(media.frameTimeMs)} 지점 장면</Text>
                    )}
                </View>
            </View>

            {faces.slice(0, 3).map((face, i) => (
                <View key={i} style={styles.card}>
                    <Text style={styles.faceTitle}>얼굴 {i + 1}</Text>
                    <Text style={styles.faceRow}>
                        조작 확률 {face.fakeProbability != null ? `${(face.fakeProbability * 100).toFixed(1)}%` : '-'}
                        {'   '}검출 신뢰도 {((face.detectionConfidence ?? face.score ?? 0) * 100).toFixed(1)}%
                        {'   '}품질 {face.quality?.label ?? '-'}
                    </Text>
                </View>
            ))}

            {hasImage ? (
                <Button label="📊 자세한 리포트 보기 (얼굴 영역·히트맵·신고)" onPress={onReport} variant="secondary" />
            ) : (
                <Text style={styles.muted}>검사 기록에는 사진이 저장되지 않아 자세한 리포트는 볼 수 없습니다.</Text>
            )}
            {media?.sourceUri && (
                <Button label="🎬 같은 영상의 다른 장면 검사" onPress={onOtherFrame} variant="secondary" />
            )}
            <Button label="다른 사진 검사" onPress={onHome} />
            {data.requestId != null && <Text style={styles.requestId}>요청 ID: {data.requestId}</Text>}
        </View>
    );
}

function ReportScreen({ media, data, onBack }) {
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
                <Text style={styles.reportTitle}>분석 리포트</Text>
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
    return (
        <View style={styles.gap}>
            <View style={[styles.card, styles.center, styles.gap]}>
                <Text style={styles.bigIcon}>⚠️</Text>
                <Text style={styles.errorText}>{message}</Text>
                {!!detail && (
                    <Text style={styles.errorDetail} selectable>자세한 원인: {detail}</Text>
                )}
            </View>
            {onRetry && <Button label="🔄 다시 시도" onPress={onRetry} />}
            <Button label="처음으로" onPress={onHome} variant="ghost" />
        </View>
    );
}

function LinkScreen({ url, onHome }) {
    return (
        <View style={styles.gap}>
            <View style={[styles.card, styles.gap]}>
                <Text style={styles.cardTitle}>🔗 링크가 공유되었습니다</Text>
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

function sourceLabel(source) {
    return { share: '공유', gallery: '갤러리', camera: '카메라' }[source] || '';
}

function formatDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    container: { padding: 16, paddingBottom: 32 },
    gap: { gap: 12 },
    center: { alignItems: 'center' },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },

    header: { marginTop: 4, marginBottom: 18 },
    title: { fontSize: 24, fontWeight: '800', color: colors.accent },
    subtitle: { marginTop: 4, fontSize: 13, color: colors.textSub },

    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 16 },
    cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
    sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
    bigIcon: { fontSize: 44 },
    bold: { fontWeight: '700', color: colors.text },
    muted: { fontSize: 13, color: colors.textSub },
    bodyText: { fontSize: 14, lineHeight: 21, color: '#CBD5E1' },
    linkText: { fontSize: 13, color: colors.accent, fontWeight: '600' },

    btn: { alignSelf: 'stretch', minHeight: 50, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
    btnPrimary: { backgroundColor: colors.accent },
    btnSecondary: { backgroundColor: 'transparent', borderColor: colors.border },
    btnGhost: { backgroundColor: 'transparent', minHeight: 44 },
    btnText: { color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
    btnTextGhost: { color: colors.textSub, fontWeight: '600' },

    tip: { backgroundColor: 'rgba(59,130,246,0.1)', borderRadius: 12, padding: 12 },
    tipText: { fontSize: 13, lineHeight: 20, color: '#CBD5E1' },

    historyItem: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border },
    historyVerdict: { fontSize: 15, fontWeight: '700' },
    historyMeta: { marginTop: 2, fontSize: 13, color: '#CBD5E1' },
    historyDate: { marginTop: 2, fontSize: 12, color: colors.textMuted },
    privacy: { fontSize: 12, lineHeight: 18, color: colors.textSub, textAlign: 'center' },

    badgeInfo: { alignSelf: 'flex-start', marginBottom: 8, fontSize: 12, color: colors.accent, fontWeight: '700' },
    preview: { width: '100%', borderRadius: 8, backgroundColor: '#000' },
    frameOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 8, backgroundColor: 'rgba(15,23,42,0.6)', alignItems: 'center', justifyContent: 'center', gap: 8 },
    frameOverlayText: { fontSize: 13, color: colors.text, fontWeight: '600' },
    framePicker: { marginTop: 12, gap: 8 },
    frameHint: { fontSize: 12, color: colors.textSub },
    frameRow: { flexDirection: 'row', gap: 8 },
    frameBtn: { flex: 1, minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    frameBtnText: { fontSize: 14, color: colors.text, fontWeight: '600' },
    frameError: { marginTop: 8, fontSize: 12, color: colors.warn },

    loadingCard: { paddingVertical: 40, gap: 10 },
    loadingText: { marginTop: 6, fontSize: 16, fontWeight: '700', color: colors.text },

    verdict: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 14, borderWidth: 1 },
    verdictReal: { backgroundColor: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.5)' },
    verdictFake: { backgroundColor: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.6)' },
    verdictIcon: { fontSize: 32 },
    verdictTitle: { fontSize: 20, fontWeight: '800' },
    faceTitle: { fontSize: 14, fontWeight: '700', color: colors.warn, marginBottom: 6 },
    faceRow: { fontSize: 13, color: '#CBD5E1', lineHeight: 20 },
    requestId: { fontSize: 11, color: colors.textMuted, textAlign: 'center' },

    errorText: { fontSize: 15, lineHeight: 23, color: colors.text, textAlign: 'center' },
    errorDetail: { fontSize: 12, lineHeight: 18, color: colors.textMuted, textAlign: 'center' },
    urlText: { fontSize: 13, color: colors.accent },

    reportBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    reportTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
});
