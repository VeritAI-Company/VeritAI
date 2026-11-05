import { View, Text } from 'react-native';
import { useTheme } from '../ui/ThemeContext';
import { Button } from '../ui/common';

export function LinkScreen({ url, onHome }) {
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
