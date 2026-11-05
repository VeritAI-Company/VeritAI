import { View, ActivityIndicator, Text } from 'react-native';
import { useTheme } from '../ui/ThemeContext';

export function LoadingScreen({ text }) {
    const { colors, styles } = useTheme();
    return (
        <View style={[styles.card, styles.center, styles.loadingCard]}>
            <ActivityIndicator size="large" color={colors.text} />
            <Text style={styles.loadingText}>{text}</Text>
            <Text style={styles.muted}>사진에 따라 몇 초 걸릴 수 있습니다</Text>
        </View>
    );
}
