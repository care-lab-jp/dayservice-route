/**
 * 移動時間・距離の取得を「プロバイダ」として抽象化する。
 * ─ ルート計算ロジック(routeEngine.ts)は地図APIを一切知らない ─
 *
 * ・APIキーなし  -> DummyProvider（直線距離ベースの推定 = デモモード）
 * ・APIキーあり  -> GoogleRoutesProvider（Routes API v2 computeRouteMatrix）
 *                   失敗時は自動でダミーへフォールバックし、アプリは止めない
 *
 * 【個人情報保護】
 * 外部APIへ渡すのは緯度・経度だけ。氏名・備考・利用者IDは一切送信しない。
 * 住所を送るのは Geocoding（住所検索）のときのみ。
 */
import type { LatLng } from '../types';
import { dummyTravelMinutes, haversineKm, isSameSpot } from './geo';
import { classifyGeocodeStatus, classifyRestError, classifyThrown, makeError, type ApiError } from './apiErrors';
import { apiStatus } from './apiStatus';
import { resolveApiKey } from './tenant';
import { loadMapsJs } from './mapsLoader';

export type TravelSource = 'google' | 'dummy';

export interface TravelMatrix {
  /** minutes[i][j] = 出発時刻の交通状況を考慮した移動時間（分） */
  minutes: number[][];
  /** staticMinutes[i][j] = 通常時（渋滞を考慮しない）の移動時間（分） */
  staticMinutes: number[][];
  /** km[i][j] = 地点i -> 地点j の道路距離（km） */
  km: number[][];
  /** estimated[i][j] = その区間がGoogleから取得できず推定で補完されたか */
  estimated: boolean[][];
  source: TravelSource;
  /** 実際に使われたルーティング設定 */
  routingPreference: RoutingPreference | 'DUMMY';
  /** 交通予測の基準にした出発時刻 */
  departureTimeIso?: string;
  /** フォールバックした場合の理由 */
  error?: ApiError;
}

export type RoutingPreference = 'TRAFFIC_AWARE_OPTIMAL' | 'TRAFFIC_AWARE' | 'TRAFFIC_UNAWARE';

/** 出発時刻を渡すと、その時刻の交通状況で計算する */
export interface MatrixOptions {
  /** 施設の出発予定時刻（Date）。未指定なら現在時刻 */
  departureTime?: Date;
  /** false にすると交通状況を使わない（費用の安いEssentials SKUで計算） */
  useTraffic?: boolean;
}

export interface TravelProvider {
  readonly source: TravelSource;
  getMatrix(points: LatLng[], options?: MatrixOptions): Promise<TravelMatrix>;
}

/* ---------------- 出発時刻の扱い ---------------- */

/**
 * Routes API の departureTime は「未来の時刻」である必要がある。
 * 送迎は朝の時間帯なので、当日の出発時刻を既に過ぎている場合は
 * 「翌日の同時刻」の交通予測を使う（曜日は変わるが時間帯の傾向は掴める）。
 */
export function resolveDepartureTime(base: Date): { date: Date; shiftedToNextDay: boolean } {
  const now = new Date();
  const MIN_AHEAD_MS = 60 * 1000; // 直前すぎると弾かれるため1分の余裕
  if (base.getTime() > now.getTime() + MIN_AHEAD_MS) return { date: base, shiftedToNextDay: false };
  const next = new Date(base);
  next.setDate(next.getDate() + 1);
  return { date: next, shiftedToNextDay: true };
}

/**
 * 地点数からルーティング設定を選ぶ。
 * ・TRAFFIC_AWARE_OPTIMAL は100要素まで（最高精度）
 * ・useTraffic=false なら TRAFFIC_UNAWARE（交通情報なし・Essentials SKUで安価）
 */
export function pickRoutingPreference(pointCount: number, useTraffic = true): RoutingPreference {
  if (!useTraffic) return 'TRAFFIC_UNAWARE';
  return pointCount * pointCount <= 100 ? 'TRAFFIC_AWARE_OPTIMAL' : 'TRAFFIC_AWARE';
}

/* ---------------- 環境変数 ---------------- */

/** .env.example の雛形文字列がそのまま残っている場合は「未設定」として扱う */
const PLACEHOLDERS = ['ここにapiキー', 'your_api_key', 'yourapikey', 'xxx'];

export function getEnvApiKey(): string {
  const raw = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '').trim().replace(/^["']|["']$/g, '');
  if (PLACEHOLDERS.includes(raw.toLowerCase())) return '';
  return raw;
}

/** 実際に使うキー（施設ごとのキー > 共通キー）。課金主体は施設単位で切替可能。 */
export function getApiKey(): string {
  return resolveApiKey(getEnvApiKey());
}

export function hasGoogleKey(): boolean {
  return getApiKey().length > 0;
}

/* ---------------- ダミー（APIキー不要 / デモモード） ---------------- */

export class DummyProvider implements TravelProvider {
  readonly source: TravelSource = 'dummy';
  async getMatrix(points: LatLng[], _options?: MatrixOptions): Promise<TravelMatrix> {
    const n = points.length;
    const minutes = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 0 : dummyTravelMinutes(points[i], points[j])))
    );
    const km = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 0 : Math.round(haversineKm(points[i], points[j]) * 1.3 * 10) / 10))
    );
    // デモモードでは通常時＝交通考慮時（渋滞情報を持たないため）。全区間が推定値。
    const estimated = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => i !== j)
    );
    return {
      minutes, staticMinutes: minutes.map((r) => r.slice()), km, estimated,
      source: 'dummy', routingPreference: 'DUMMY',
    };
  }
}

/* ---------------- Google Routes API v2 ---------------- */
/* エンドポイント: https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix */

export class GoogleRoutesProvider implements TravelProvider {
  readonly source: TravelSource = 'google';
  constructor(private apiKey: string) {}

  async getMatrix(points: LatLng[], options?: MatrixOptions): Promise<TravelMatrix> {
    const n = points.length;
    // TRAFFIC_AWARE_OPTIMAL: 100要素まで / TRAFFIC_AWARE: 625要素まで
    if (n * n > 625) throw makeError('TOO_MANY', `elements=${n * n}`);
    const useTraffic = options?.useTraffic !== false;
    const routingPreference = pickRoutingPreference(n, useTraffic);

    const { date: departureTime } = resolveDepartureTime(options?.departureTime ?? new Date());
    const departureTimeIso = useTraffic ? departureTime.toISOString() : undefined;

    // 座標のみを送信（氏名・住所は含めない）
    const wp = (p: LatLng) => ({
      waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } },
    });

    let res: Response;
    try {
      res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          // staticDuration = 通常時（渋滞なし）の所要時間
          'X-Goog-FieldMask':
            'originIndex,destinationIndex,duration,staticDuration,distanceMeters,condition',
        },
        body: JSON.stringify({
          origins: points.map(wp),
          destinations: points.map(wp),
          travelMode: 'DRIVE',
          routingPreference,
          // ★出発予定時刻の交通状況で計算する（交通OFFのときは送らない）
          ...(departureTimeIso ? { departureTime: departureTimeIso } : {}),
          languageCode: 'ja',
          units: 'METRIC',
        }),
      });
    } catch (e) {
      throw classifyThrown(e);
    }
    if (!res.ok) throw await classifyRestError(res);

    let rows: Array<{
      originIndex: number;
      destinationIndex: number;
      duration?: string;
      staticDuration?: string;
      distanceMeters?: number;
      condition?: string;
    }>;
    try {
      rows = await res.json();
    } catch (e) {
      throw classifyThrown(e);
    }

    const minutes = Array.from({ length: n }, () => Array<number>(n).fill(0));
    const staticMinutes = Array.from({ length: n }, () => Array<number>(n).fill(0));
    const km = Array.from({ length: n }, () => Array<number>(n).fill(0));
    const estimated = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
    const toMinutes = (d?: string) => Math.max(1, Math.round(Number(String(d ?? '0s').replace('s', '')) / 60));
    let ok = 0;

    for (const r of rows) {
      const i = r.originIndex;
      const j = r.destinationIndex;
      if (i === j) continue;
      if (r.condition && r.condition !== 'ROUTE_EXISTS') continue;
      if (isSameSpot(points[i], points[j])) { ok++; continue; } // 同一住所は0分
      minutes[i][j] = toMinutes(r.duration);
      staticMinutes[i][j] = r.staticDuration ? toMinutes(r.staticDuration) : minutes[i][j];
      km[i][j] = Math.round(((r.distanceMeters ?? 0) / 1000) * 10) / 10;
      ok++;
    }
    if (ok === 0) throw makeError('NO_ROUTE', JSON.stringify(rows).slice(0, 300));

    // 経路が取れなかったマスだけ推定値で埋める（部分的な欠損でも止めない）
    // ただし「推定で埋めた」ことは estimated に記録し、画面と印刷物に明示する。
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (isSameSpot(points[i], points[j])) continue; // 同一住所は0分で正しい
        if (minutes[i][j] === 0) {
          minutes[i][j] = dummyTravelMinutes(points[i], points[j]);
          staticMinutes[i][j] = minutes[i][j];
          km[i][j] = Math.round(haversineKm(points[i], points[j]) * 1.3 * 10) / 10;
          estimated[i][j] = true;
        }
      }
    }
    return { minutes, staticMinutes, km, estimated, source: 'google', routingPreference, departureTimeIso };
  }
}

/* ---------------- 選択（キーの有無で自動切替） ---------------- */

export function createTravelProvider(): TravelProvider {
  const key = getApiKey();
  const dummy = new DummyProvider();
  if (!key) {
    apiStatus.mode('demo');
    return dummy;
  }
  const google = new GoogleRoutesProvider(key);
  return {
    source: 'google',
    async getMatrix(points, options) {
      try {
        const m = await google.getMatrix(points, options);
        apiStatus.success(`Routes API (${m.routingPreference})`);
        return m;
      } catch (e) {
        const err = (e as ApiError)?.code ? (e as ApiError) : classifyThrown(e);
        console.warn('[travelProvider] Routes API 失敗のため推定値へ切替:', err);
        apiStatus.fallback(err);
        const fb = await dummy.getMatrix(points, options);
        return { ...fb, error: err };
      }
    },
  };
}

/* ---------------- Geocoding API（住所 -> 緯度経度） ---------------- */
/* 送信するのは住所文字列のみ。利用者名・備考は送らない。 */

export interface GeocodeCandidate {
  lat: number;
  lng: number;
  /** Googleが正規化した住所（確認用に表示する） */
  formattedAddress: string;
  /** 番地まで特定できたか（ROOFTOP/RANGE_INTERPOLATED なら精度が高い） */
  locationType?: string;
}

export interface GeocodeResult extends GeocodeCandidate {
  /** 候補が複数あるときは職員に選ばせる（先頭を黙って採用しない） */
  candidates: GeocodeCandidate[];
}

/**
 * 住所 -> 座標。
 * 1) Maps JavaScript API の Geocoder（ブラウザ向け。ウェブサイト制限つきキーでも動く）
 * 2) 失敗したら Geocoding API(REST) にフォールバック
 * どちらもGoogleへ送るのは住所文字列のみ。
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const key = getApiKey();
  if (!key) throw makeError('NO_KEY');
  if (!address.trim()) throw makeError('NOT_FOUND', 'empty address');

  try {
    const viaJs = await geocodeViaMapsJs(address, key);
    if (viaJs) {
      apiStatus.success('Maps JavaScript API (Geocoder)');
      return viaJs;
    }
  } catch (e) {
    const err = (e as ApiError)?.code ? (e as ApiError) : classifyThrown(e);
    // ZERO_RESULTS はRESTでも同じ結果になるため、ここで確定させる
    if (err.code === 'NOT_FOUND') { apiStatus.error(err); throw err; }
    console.warn('[geocode] Maps JS 経由に失敗、RESTへフォールバック:', err);
  }

  const url =
    'https://maps.googleapis.com/maps/api/geocode/json' +
    `?language=ja&region=JP&address=${encodeURIComponent(address.trim())}&key=${encodeURIComponent(key)}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    const err = classifyThrown(e);
    apiStatus.error(err);
    throw err;
  }
  if (!res.ok) {
    const err = await classifyRestError(res);
    apiStatus.error(err);
    throw err;
  }

  const json = await res.json();
  if (json.status !== 'OK') {
    // 失敗の詳細を施設設定画面から確認できるように記録する
    const err = classifyGeocodeStatus(json.status, json.error_message);
    apiStatus.error(err);
    throw err;
  }

  const results: any[] = Array.isArray(json.results) ? json.results : [];
  const candidates: GeocodeCandidate[] = results
    .filter((r) => r?.geometry?.location)
    .slice(0, 5)
    .map((r) => ({
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      formattedAddress: r.formatted_address ?? address,
      locationType: r.geometry.location_type,
    }));
  if (candidates.length === 0) {
    const err = makeError('NOT_FOUND');
    apiStatus.error(err);
    throw err;
  }
  apiStatus.success('Geocoding API');
  return { ...candidates[0], candidates };
}

/** Maps JavaScript API の Geocoder を使う（ブラウザ以外では null を返す） */
async function geocodeViaMapsJs(address: string, key: string): Promise<GeocodeResult | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  await loadMapsJs(key);
  const g = (window as any).google;
  if (!g?.maps) return null;
  await g.maps.importLibrary('geocoding');

  const geocoder = new g.maps.Geocoder();
  let response: any;
  try {
    response = await geocoder.geocode({ address, language: 'ja', region: 'JP' });
  } catch (e: any) {
    // Geocoder は status 文字列を持つエラーを投げる（ZERO_RESULTS など）
    const status = e?.code ?? e?.status ?? '';
    if (status) throw classifyGeocodeStatus(String(status), e?.message);
    throw classifyThrown(e);
  }

  const results: any[] = response?.results ?? [];
  const candidates: GeocodeCandidate[] = results.slice(0, 5).map((r) => ({
    lat: typeof r.geometry.location.lat === 'function' ? r.geometry.location.lat() : r.geometry.location.lat,
    lng: typeof r.geometry.location.lng === 'function' ? r.geometry.location.lng() : r.geometry.location.lng,
    formattedAddress: r.formatted_address ?? address,
    locationType: r.geometry.location_type,
  }));
  if (candidates.length === 0) throw makeError('NOT_FOUND');
  return { ...candidates[0], candidates };
}
