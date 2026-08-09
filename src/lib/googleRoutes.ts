/**
 * Routes API v2 の computeRoutes を使い、
 * 「実際の道路に沿ったルート形状（ポリライン）」と区間ごとの距離・時間を取得する。
 * エンドポイント: https://routes.googleapis.com/directions/v2:computeRoutes
 *
 * 巡回順の決定は routeEngine.ts が行い、ここは決まった順番の描画用データを取るだけ。
 * 送信するのは座標のみ。
 */
import type { LatLng, TrafficInterval, TrafficSpeed } from '../types';
import { classifyRestError, classifyThrown, makeError, type ApiError } from './apiErrors';
import { apiStatus } from './apiStatus';
import { getApiKey, pickRoutingPreference, resolveDepartureTime } from './travelProvider';

export interface RouteShape {
  /** Googleのエンコード済みポリライン（地図描画に使用） */
  encodedPolyline: string;
  totalKm: number;
  /** 出発時刻の交通状況を考慮した所要時間 */
  totalMin: number;
  /** 通常時（渋滞なし）の所要時間 */
  totalStaticMin: number;
  /** 区間ごと（出発地→1件目→…→施設）の距離km・時間分 */
  legs: { km: number; min: number; staticMin: number }[];
  /** ルート上の交通状況（渋滞可視化用） */
  trafficIntervals: TrafficInterval[];
  departureTimeIso: string;
}

/**
 * @param origin  出発地（施設）
 * @param stops   立ち寄り順の座標
 * @param dest    帰着地（施設）
 */
export async function fetchRouteShape(
  origin: LatLng,
  stops: LatLng[],
  dest: LatLng,
  departure?: Date,
  useTraffic = true
): Promise<RouteShape> {
  const key = getApiKey();
  if (!key) throw makeError('NO_KEY');

  const { date } = resolveDepartureTime(departure ?? new Date());
  const departureTimeIso = useTraffic ? date.toISOString() : '';
  // 経由地が少ないうちは最も精度の高い設定を使う
  const routingPreference = pickRoutingPreference(stops.length + 2, useTraffic);

  const loc = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });

  let res: Response;
  try {
    res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        // 必要な項目だけを要求する（課金・通信量の節約）
        'X-Goog-FieldMask': [
          'routes.polyline.encodedPolyline',
          'routes.distanceMeters',
          'routes.duration',
          'routes.staticDuration',
          'routes.legs.distanceMeters',
          'routes.legs.duration',
          'routes.legs.staticDuration',
          // ルート上の渋滞区間（TRAFFIC_ON_POLYLINE と対で使う）
          'routes.travelAdvisory.speedReadingIntervals',
        ].join(','),
      },
      body: JSON.stringify({
        origin: loc(origin),
        destination: loc(dest),
        intermediates: stops.map(loc),
        travelMode: 'DRIVE',
        routingPreference,
        // ★出発予定時刻の交通状況で計算する（交通OFFのときは送らない）
        ...(departureTimeIso ? { departureTime: departureTimeIso } : {}),
        // 順番はアプリ側（希望時間を考慮した最適化）で決めるので並べ替えさせない
        optimizeWaypointOrder: false,
        polylineQuality: 'OVERVIEW',
        ...(useTraffic ? { extraComputations: ['TRAFFIC_ON_POLYLINE'] } : {}),
        languageCode: 'ja',
        units: 'METRIC',
      }),
    });
  } catch (e) {
    throw classifyThrown(e);
  }
  if (!res.ok) throw await classifyRestError(res);

  const json = await res.json();
  const route = json?.routes?.[0];
  if (!route?.polyline?.encodedPolyline) throw makeError('NO_ROUTE', JSON.stringify(json).slice(0, 300));

  const min = (d?: string) => Math.max(1, Math.round(Number(String(d ?? '0s').replace('s', '')) / 60));

  const legs = (route.legs ?? []).map(
    (l: { distanceMeters?: number; duration?: string; staticDuration?: string }) => ({
      km: Math.round(((l.distanceMeters ?? 0) / 1000) * 10) / 10,
      min: min(l.duration),
      staticMin: l.staticDuration ? min(l.staticDuration) : min(l.duration),
    })
  );

  const trafficIntervals: TrafficInterval[] = (
    route.travelAdvisory?.speedReadingIntervals ?? []
  ).map((iv: { startPolylinePointIndex?: number; endPolylinePointIndex?: number; speed?: string }) => ({
    startIndex: iv.startPolylinePointIndex ?? 0,
    endIndex: iv.endPolylinePointIndex ?? 0,
    speed: (iv.speed as TrafficSpeed) ?? 'NORMAL',
  }));

  apiStatus.success(`Routes API computeRoutes (${routingPreference})`);
  return {
    encodedPolyline: route.polyline.encodedPolyline,
    totalKm: Math.round(((route.distanceMeters ?? 0) / 1000) * 10) / 10,
    totalMin: min(route.duration),
    totalStaticMin: route.staticDuration ? min(route.staticDuration) : min(route.duration),
    legs,
    trafficIntervals,
    departureTimeIso,
  };
}

/** 失敗してもアプリを止めないラッパー */
export async function tryFetchRouteShape(
  origin: LatLng,
  stops: LatLng[],
  dest: LatLng,
  departure?: Date,
  useTraffic = true
): Promise<{ shape: RouteShape | null; error: ApiError | null }> {
  try {
    return { shape: await fetchRouteShape(origin, stops, dest, departure, useTraffic), error: null };
  } catch (e) {
    const err = (e as ApiError)?.code ? (e as ApiError) : classifyThrown(e);
    if (err.code !== 'NO_KEY') {
      console.warn('[googleRoutes] ルート形状の取得に失敗:', err);
      apiStatus.fallback(err);
    }
    return { shape: null, error: err };
  }
}

/** Googleのエンコード済みポリラインを座標配列へ復号（geometryライブラリ不要） */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}
