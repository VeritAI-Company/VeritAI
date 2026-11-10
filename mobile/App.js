import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import { Alert, BackHandler, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { colors as themeColors } from './src/theme';
import { makeStyles } from './src/ui/styles';
import { ThemeContext, useTheme } from './src/ui/ThemeContext';
import { loadHistory, addHistory, toHistoryEntry, clearHistory } from './src/history';
import { clearMyRecords, getStoredRequestIds } from './src/records';
import { prepareMedia, toFileUri, isVideoMime, clampFrameTime, prepareVideoFrame, formatTime } from './src/media';
import { parseDurationMs } from './src/sliderMath';
import { requestDetection, toFriendlyMessage, toErrorDetail, fetchDetection, ensureAiResult } from './src/api';
import { ReportScreen } from './src/screens/ReportScreen';
import { Header } from './src/ui/common';
import { HomeScreen } from './src/screens/HomeScreen';
import { PreviewScreen } from './src/screens/PreviewScreen';
import { LoadingScreen } from './src/screens/LoadingScreen';
import { ResultScreen } from './src/screens/ResultScreen';
import { ErrorScreen } from './src/screens/ErrorScreen';
import { LinkScreen } from './src/screens/LinkScreen';

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
    const [serverRecordCount, setServerRecordCount] = useState(0); // 서버에서 아직 안 지운 내 검사 기록 수 (처리 중이라 남은 것 포함)
    const busyRef = useRef(false);
    const [frameBusy, setFrameBusy] = useState(false);
    const [frameError, setFrameError] = useState('');

    const { hasShareIntent, shareIntent, resetShareIntent, error: shareError } = useShareIntentContext();

    const refreshServerRecordCount = useCallback(async () => {
        setServerRecordCount((await getStoredRequestIds()).length);
    }, []);

    useEffect(() => {
        loadHistory().then(setHistory);
        refreshServerRecordCount();
    }, [refreshServerRecordCount]);

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
            handleMediaSelected({ uri: toFileUri(file.path), isVideo: isVideoMime(file.mimeType), durationMs: parseDurationMs(file.duration) }, 'share');
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
        const durationMs = parseDurationMs(asset.duration);
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
            refreshServerRecordCount(); // 실패해도 서버에 기록이 생겼을 수 있다
        }
    };

    const clearAllHistory = () => {
        Alert.alert('검사 기록 전체 삭제', '이 폰의 검사 기록과 서버에 남은 검사 기록을 함께 지웁니다.', [
            { text: '취소', style: 'cancel' },
            {
                text: '삭제',
                style: 'destructive',
                onPress: async () => {
                    try {
                        const summary = await clearMyRecords();
                        setHistory(await clearHistory());
                        const pending = summary.pendingIds?.length || 0;
                        if (pending > 0) {
                            Alert.alert('일부 기록이 남았습니다', `처리 중인 검사 ${pending}건은 끝난 뒤 "남은 기록 지우기"를 다시 눌러 주세요.`);
                        }
                    } catch (err) {
                        Alert.alert('삭제하지 못했습니다', err?.status === 0
                            ? '서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.'
                            : '검사 기록을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.');
                    } finally {
                        refreshServerRecordCount();
                    }
                },
            },
        ]);
    };

    const openHistory = async (item) => {
        setLoadingText('기록을 불러오는 중...');
        setScreen('loading');
        setMedia(null);
        try {
            const response = await fetchDetection(item.requestId);
            if (response.status !== 'DONE' || !response.result) throw new Error('아직 분석이 끝나지 않은 기록입니다.');
            setData(ensureAiResult(response));
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
                            onClearHistory={clearAllHistory}
                            serverRecordCount={serverRecordCount}
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