export const API_URL = "http://localhost:8080/api/detections";
export const FEEDBACK_URL = "http://localhost:8080/api/feedback";
export const POLL_INITIAL_INTERVAL_MS = 300;
export const POLL_MAX_INTERVAL_MS = 2000;
export const POLL_TIMEOUT_MS = 180000;
export const MAX_CONCURRENT_INSPECTIONS = (navigator.hardwareConcurrency || 4) <= 4 ? 2 : 3;
export const FACE_CROP_ANALYSIS_MODE = "face_crop_only";
export const MAX_CACHE_SIZE = 500;
export const GLOBAL_AD_SELECTOR = '.adsbygoogle, [id^="google_ads"], [id*="banner"], [class*="banner"], [id*="sponsor"], [class*="sponsor"], [class*="advertisement"], [class*="promo"], [class~="ad"], [class|="ad"]';