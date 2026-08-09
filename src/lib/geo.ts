import type { LatLng } from '../types';

/** 2地点間の直線距離（km） */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * ダミー移動時間（分）。
 * 市街地の平均時速を仮定し、道路の迂回分を係数で補正、さらに発進停止の固定時間を足す。
 */
export function dummyTravelMinutes(a: LatLng, b: LatLng): number {
  const AVG_KMH = 22;      // 市街地の平均速度
  const DETOUR = 1.3;      // 直線距離 -> 道路距離の補正
  const FIXED = 1.5;       // 発進・停止・徐行などの固定ロス
  // 同一住所（夫婦・同一施設など）は移動0分。停車時間は乗車時間補正で別途加算される
  if (isSameSpot(a, b)) return 0;
  const km = haversineKm(a, b) * DETOUR;
  return Math.max(1, Math.round((km / AVG_KMH) * 60 + FIXED));
}

/** 同じ場所とみなす距離（約20m以内） */
export function isSameSpot(a: LatLng, b: LatLng): boolean {
  return haversineKm(a, b) < 0.02;
}
