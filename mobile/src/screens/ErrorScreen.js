// 오류 화면
import { View, Text } from 'react-native';
import { useTheme } from '../ui/ThemeContext';
import { Button } from '../ui/common';

export function ErrorScreen({ message, detail, onRetry, onHome }) {
    const { colors, styles } = useTheme();
    return (
        <View style={styles.gap}>
            <View style={[styles.card, styles.center, styles.gap, styles.errorCard]}>
                <Text style={styles.errorTitle}>문제가 생겼습니다</Text>
                <Text style={styles.errorText}>{message}</Text>
                {/* 서버 주소 같은 개발용 원인은 개발 빌드에서만 보여 준다 */}
                {__DEV__ && !!detail && (
                    <Text style={styles.errorDetail} selectable>자세한 원인: {detail}</Text>
                )}
            </View>
            {onRetry && <Button label="다시 시도" onPress={onRetry} />}
            <Button label="처음으로" onPress={onHome} variant="ghost" />
        </View>
    );
}
