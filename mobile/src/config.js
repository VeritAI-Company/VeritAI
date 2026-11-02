// 서버 주소: mobile/.env 의 EXPO_PUBLIC_API_BASE, EXPO_PUBLIC_PORTAL_URL (예시는 mobile/.env.example). 없으면 내 컴퓨터 주소를 쓴다.
// 개발: USB 연결 후 adb reverse tcp:8080 tcp:8080 / tcp:5173 tcp:5173 을 하면 폰의 localhost 가 PC로 연결됨
export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:8080').replace(/\/$/, '');
export const PORTAL_URL = (process.env.EXPO_PUBLIC_PORTAL_URL || 'http://localhost:5173').replace(/\/$/, '');

export const CLIENT_TYPE = 'react-native-app';
