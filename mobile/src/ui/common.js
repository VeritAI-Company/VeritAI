import { View, Text, Pressable } from 'react-native';
import { useTheme } from './ThemeContext';

export function Header() {
    const { colors, styles } = useTheme();
    return (
        <View style={styles.header}>
            <Text style={styles.title}>VeritAI</Text>
            <Text style={styles.subtitle}>사진·영상 속 얼굴의 딥페이크 조작 여부 검사</Text>
        </View>
    );
}

export function Button({ label, onPress, variant = 'primary', disabled = false }) {
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
