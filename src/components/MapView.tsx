/**
 * 地図表示。ルート計算ロジックとは完全に分離されている。
 * ・APIキーあり : Maps JavaScript API（動的ライブラリ読み込み + AdvancedMarkerElement）
 *                 ルート作成後は Routes API から得た実道路のポリラインを描画
 * ・APIキーなし : SVGの簡易マップ（デモモード。見た目・レイアウトは従来どおり）
 *
 * 【重要】地図へ渡すのはマーカー記号（F / ① ② ③）と座標のみ。利用者名は渡さない。
 */
import { useEffect, useRef, useState } from 'react';
import { getApiKey, hasGoogleKey } from '../lib/travelProvider';
import { resolveMapId } from '../lib/tenant';
import { decodePolyline } from '../lib/googleRoutes';
import { makeError, type ApiError } from '../lib/apiErrors';
import { getMapsAuthFailure, loadMapsJs } from '../lib/mapsLoader';
import { apiStatus } from '../lib/apiStatus';
import type { LatLng, TrafficInterval } from '../types';

export interface MapPoint {
  lat: number;
  lng: number;
  /** 表示ラベル（匿名。施設は F、利用者は ① ② ③ …） */
  label: string;
  kind: 'facility' | 'stop';
}

/** 1,2,3... を ①②③ に（21以上はそのまま数字） */
export function circledNumber(n: number): string {
  return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n);
}

/* ---------------- 本体 ---------------- */

/** 交通状況の色（赤は渋滞のみに使う） */
export const TRAFFIC_COLORS: Record<string, string> = {
  NORMAL: '#2f6f4e',
  SLOW: '#e8a33d',
  TRAFFIC_JAM: '#c0392b',
};

export default function MapView({
  points,
  encodedPolyline,
  trafficIntervals,
}: {
  points: MapPoint[];
  /** Routes APIから得た実道路のルート（あれば道なりに描画） */
  encodedPolyline?: string;
  /** ルート上の交通状況（区間ごとに色分け） */
  trafficIntervals?: TrafficInterval[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    // 地点が1つ以下では地図として意味がなく、fitBounds も不安定になる
    if (!hasGoogleKey() || points.length < 2) return;
    let cancelled = false;

    (async () => {
      try {
        await loadMapsJs(getApiKey());
        if (cancelled || !ref.current) return;
        const authFailed = getMapsAuthFailure();
        if (authFailed) { setError(authFailed); return; }

        const g = window.google;
        const { Map } = await g.maps.importLibrary('maps');
        const { AdvancedMarkerElement } = await g.maps.importLibrary('marker');
        if (cancelled || !ref.current) return;

        if (!mapRef.current) {
          mapRef.current = new Map(ref.current, {
            zoom: 13,
            center: { lat: points[0].lat, lng: points[0].lng },
            // Advanced Marker には Map ID が必須。DEMO_MAP_ID は開発用のため
            // 本番運用では施設のGoogle Cloudで作成した Map ID を設定する
            mapId: resolveMapId(),
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          });
        }
        const map = mapRef.current;

        // 前回のマーカー・線を消す
        overlaysRef.current.forEach((o) => { if (o.setMap) o.setMap(null); else o.map = null; });
        overlaysRef.current = [];

        const bounds = new g.maps.LatLngBounds();
        points.forEach((p) => {
          const el = document.createElement('div');
          el.textContent = p.label;
          el.style.cssText = [
            'display:grid', 'place-items:center',
            `width:${p.kind === 'facility' ? 34 : 30}px`,
            `height:${p.kind === 'facility' ? 34 : 30}px`,
            'border-radius:9999px',
            `background:${p.kind === 'facility' ? '#1f2933' : '#2f6f4e'}`,
            'color:#fff', 'font-weight:700', 'font-size:15px',
            'border:2px solid #fff', 'box-shadow:0 1px 4px rgba(0,0,0,.35)',
          ].join(';');
          const marker = new AdvancedMarkerElement({
            map, position: { lat: p.lat, lng: p.lng }, content: el,
            title: p.kind === 'facility' ? '施設' : p.label, // 匿名ラベルのみ
          });
          overlaysRef.current.push(marker);
          bounds.extend({ lat: p.lat, lng: p.lng });
        });

        // ルート線：実道路のポリラインがあればそれを、無ければ直線でつなぐ
        const path: LatLng[] = encodedPolyline
          ? decodePolyline(encodedPolyline)
          : points.map((p) => ({ lat: p.lat, lng: p.lng }));

        if (trafficIntervals && trafficIntervals.length > 0 && encodedPolyline) {
          // 交通状況の区間ごとに色を変えて描く（順調=緑 / やや混雑=橙 / 渋滞=赤）
          trafficIntervals.forEach((iv) => {
            const seg = path.slice(iv.startIndex, Math.min(iv.endIndex + 1, path.length));
            if (seg.length < 2) return;
            const line = new g.maps.Polyline({
              path: seg, map,
              strokeColor: TRAFFIC_COLORS[iv.speed] ?? TRAFFIC_COLORS.NORMAL,
              strokeWeight: 6, strokeOpacity: 0.9,
            });
            overlaysRef.current.push(line);
          });
        } else {
          const line = new g.maps.Polyline({
            path, map, strokeColor: '#2f6f4e', strokeWeight: 5, strokeOpacity: 0.85,
          });
          overlaysRef.current.push(line);
        }
        path.forEach((p) => bounds.extend(p));

        map.fitBounds(bounds, 56);
        setError(null);
      } catch (e) {
        const err = (e as ApiError)?.code ? (e as ApiError) : makeError('UNKNOWN', String(e));
        apiStatus.fallback(err);
        setError(err);
      }
    })();

    return () => { cancelled = true; };
  }, [points, encodedPolyline, trafficIntervals]);

  if (hasGoogleKey() && !error && points.length >= 2) {
    return <div ref={ref} className="w-full h-80 rounded-xl border border-gray-200 bg-gray-100" />;
  }
  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="font-bold">△ 地図を表示できませんでした：{error.message}</p>
          <p className="text-gray-600">{error.hint}</p>
        </div>
      )}
      <SimpleMap points={points} />
    </div>
  );
}

/** APIキーなし・地図エラー時でも位置関係が分かる簡易マップ（従来どおりの見た目） */
function SimpleMap({ points }: { points: MapPoint[] }) {
  if (points.length === 0) {
    return <div className="h-80 grid place-items-center text-gray-400 border rounded-xl">地点がありません</div>;
  }
  const W = 700, H = 320, PAD = 40;
  const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const sx = (lng: number) =>
    maxLng === minLng ? W / 2 : PAD + ((lng - minLng) / (maxLng - minLng)) * (W - PAD * 2);
  const sy = (lat: number) =>
    maxLat === minLat ? H / 2 : H - PAD - ((lat - minLat) / (maxLat - minLat)) * (H - PAD * 2);
  const path = points.map((p) => `${sx(p.lng)},${sy(p.lat)}`).join(' ');

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-72">
        <rect x="0" y="0" width={W} height={H} fill="#f4f6f5" rx="12" />
        <polyline points={path} fill="none" stroke="#2f6f4e" strokeWidth="3" strokeDasharray="6 5" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={sx(p.lng)} cy={sy(p.lat)} r={p.kind === 'facility' ? 16 : 14}
              fill={p.kind === 'facility' ? '#1f2933' : '#2f6f4e'} />
            <text x={sx(p.lng)} y={sy(p.lat) + 5} textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
      <p className="text-sm text-gray-500 px-2 pb-1">
        簡易マップ（位置関係の目安）。Google Maps APIキーを設定すると実際の地図と道路ルートが表示されます。
      </p>
    </div>
  );
}
