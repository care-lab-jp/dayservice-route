/**
 * Maps JavaScript API の読み込みを一元化する。
 * 地図表示(MapView)と住所検索(Geocoder)の両方から使う。
 */
import { makeError, type ApiError } from './apiErrors';
import { apiStatus } from './apiStatus';

declare global {
  interface Window {
    google?: any;
    gm_authFailure?: () => void;
  }
}

let loaderPromise: Promise<void> | null = null;
let authFailed: ApiError | null = null;

export function getMapsAuthFailure(): ApiError | null {
  return authFailed;
}

export function loadMapsJs(key: string): Promise<void> {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (loaderPromise) return loaderPromise;

  // gm_authFailure は「キーが無効」「APIが未有効」「リファラー制限」のいずれでも発火し、
  // 原因を区別できない。断定せず、考えられる原因をすべて案内する。
  window.gm_authFailure = () => {
    authFailed = makeError('MAPS_AUTH', 'gm_authFailure');
    apiStatus.fallback(authFailed);
  };

  loaderPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    const params = new URLSearchParams({
      key, v: 'weekly', libraries: 'marker,geocoding',
      language: 'ja', region: 'JP', loading: 'async',
    });
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(makeError('NETWORK', 'Maps JavaScript API の読み込みに失敗'));
    document.head.appendChild(s);
  });
  return loaderPromise;
}
