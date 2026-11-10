import { ANALYSIS_MODE, apiUrls } from '../../shared/api.js';

// 결과를 물어보는 간격과 기다리는 시간은 PWA와 같은 값을 쓴다 (shared/api.js)
export { POLL_INITIAL_INTERVAL_MS, POLL_MAX_INTERVAL_MS, POLL_TIMEOUT_MS } from '../../shared/api.js';

// 분석 서버 주소: 프로젝트 루트 .env 의 VITE_API_BASE 를 빌드할 때 vite.config.js 가 넣어 준다. 없으면 내 컴퓨터(localhost:8080)
const API_BASE = typeof __VERITAI_API_BASE__ !== 'undefined' ? __VERITAI_API_BASE__ : 'http://localhost:8080';
const urls = apiUrls(API_BASE);
export const API_URL = urls.detections;
export const FEEDBACK_URL = urls.feedback;
export const FACE_CROP_ANALYSIS_MODE = ANALYSIS_MODE;
export const MAX_CONCURRENT_INSPECTIONS = (navigator.hardwareConcurrency || 4) <= 4 ? 2 : 3;
export const MAX_CACHE_SIZE = 200;
// 광고 판별 두 단계. 확실한 광고는 버튼도 자동 검사도 없다.
// 애매한 영역은 자동 검사만 빼고 버튼은 붙인다 (기사 메인 사진, 유명인 사칭 광고처럼 직접 확인하고 싶은 사진이 있어서)
export const STRONG_AD_SELECTOR = '.adsbygoogle, [id^="google_ads"], [class*="advertisement"], [class~="ad"], [class|="ad"]';
export const WEAK_AD_SELECTOR = '[id*="banner"], [class*="banner"], [id*="sponsor"], [class*="sponsor"], [class*="promo"]';
export const WEAK_AD_MAX_DEPTH = 4; // 사진 위로 이 단계까지만 본다 (페이지 전체를 감싼 class 때문에 모든 사진이 빠지지 않게)
export const GLOBAL_AD_SELECTOR = `${STRONG_AD_SELECTOR}, ${WEAK_AD_SELECTOR}`;