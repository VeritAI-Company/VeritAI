// 자세한 리포트 화면 (PWA 리포트를 WebView로 띄운다)
import { useRef, useState } from 'react';
import { View, Pressable, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../ui/ThemeContext';
import { ErrorScreen } from './ErrorScreen';
import { PORTAL_URL } from '../config';

export function ReportScreen({ media, data, onBack }) {
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
                        message={__DEV__
                            ? '웹 리포트를 열 수 없습니다.\nPC에서 포털(npm run dev:portal)이 켜져 있는지, adb reverse tcp:5173 tcp:5173 을 했는지 확인해 주세요.'
                            : '자세한 리포트를 열 수 없습니다.\n인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.'}
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
