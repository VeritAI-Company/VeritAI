// 색과 스타일을 모든 화면에 나눠 주는 컨텍스트
import { createContext, useContext } from 'react';

// 색과 스타일을 모든 화면에 나눠 준다
export const ThemeContext = createContext(null);

export function useTheme() {
    return useContext(ThemeContext);
}
