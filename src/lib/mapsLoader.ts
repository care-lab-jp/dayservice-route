/**
 * Maps JavaScript API の読み込みを一元化する。
 * 地図表示(MapView)と住所検索(Geocoder)の両方から使う。
 *
 * 【注意】script の onload と API の初期化完了は一致しない。
 * onload 直後は google.maps は存在しても importLibrary が未定義のことがあり、
 * 端末・ブラウザによって "importLibrary is not a function" になる。
 * そのため準備完了を明示的に待ち、さらに importLibrary が使えない環境でも
 * 動くようフォールバックを用意している。
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

/** google.maps が使える状態になるまで待つ（最大 timeoutMs） */
function waitForMapsReady(timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const maps = window.google?.maps;
      // importLibrary（新方式）か Map（従来の名前空間）のどちらかが使えればOK
      if (maps && (typeof maps.importLibrary === 'function' || typeof maps.Map === 'function')) {
        resolve();
        return;
      }
      if (authFailed) { reject(authFailed); return; }
      if (Date.now() - started > timeoutMs) {
        reject(makeError('NETWORK', 'Maps JavaScript API の初期化がタイムアウトしました'));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

export function loadMapsJs(key: string): Promise<void> {
  if (window.google?.maps && typeof window.google.maps.importLibrary === 'function') {
    return Promise.resolve();
  }
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
    // onload だけでは早すぎるため、初期化完了を待ってから解決する
    s.onload = () => waitForMapsReady().then(resolve, reject);
    s.onerror = () => reject(makeError('NETWORK', 'Maps JavaScript API の読み込みに失敗'));
    document.head.appendChild(s);
  }).catch((e) => {
    // 失敗したら次回リトライできるようにキャッシュを捨てる
    loaderPromise = null;
    throw e;
  });
  return loaderPromise;
}

/**
 * ライブラリを取得する。
 * importLibrary が使える環境ではそれを使い、使えない環境では
 * すでに読み込み済みの google.maps 名前空間をそのまま返す。
 */
export async function importMapsLibrary(name: 'maps' | 'marker' | 'geocoding'): Promise<any> {
  const maps = window.google?.maps;
  if (!maps) throw makeError('NETWORK', 'Maps JavaScript API が読み込まれていません');
  if (typeof maps.importLibrary === 'function') {
    return maps.importLibrary(name);
  }
  // 従来の名前空間から取り出す（script の libraries= で読み込み済み）
  if (name === 'maps') return { Map: maps.Map };
  if (name === 'marker') return { AdvancedMarkerElement: maps.marker?.AdvancedMarkerElement };
  return { Geocoder: maps.Geocoder };
}
