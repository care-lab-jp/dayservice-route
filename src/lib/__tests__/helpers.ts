/** テスト用のデータ生成ヘルパー（実データは使わず、すべて架空の値） */
import type { LatLng, Member, Vehicle } from '../../types';
import type { TravelMatrix } from '../travelProvider';
import type { RouteInput } from '../routeEngine';
import { toMin } from '../time';

export const FACILITY: LatLng = { lat: 34.815, lng: 134.685 };

let seq = 0;
export function member(p: Partial<Member> & { name: string }): Member {
  seq++;
  return {
    id: p.id ?? `m-${seq}`,
    name: p.name,
    postalCode: '000-0000',
    address: '架空県架空市',
    lat: p.lat ?? 34.82,
    lng: p.lng ?? 134.69,
    pickupFrom: p.pickupFrom ?? '08:00',
    pickupTo: p.pickupTo ?? '09:00',
    dropoffFrom: '16:00',
    dropoffTo: '16:45',
    boardingMinutes: p.boardingMinutes ?? 3,
    maxRideMinutes: p.maxRideMinutes,
    requiresWheelchair: p.requiresWheelchair,
    note: p.note ?? '',
    active: p.active ?? true,
  };
}

export function vehicle(p: Partial<Vehicle> & { id: string; name: string }): Vehicle {
  return {
    id: p.id, name: p.name,
    capacity: p.capacity ?? 8,
    wheelchair: p.wheelchair ?? false,
    active: p.active ?? true,
  };
}

/**
 * 移動時間マトリクスを直接与える。
 * minutes[i][j] の i,j は [0]=施設, [1..n]=利用者, [n+1]=施設。
 * 実APIを呼ばずにアルゴリズムだけを検証するための仕組み。
 */
export function matrix(
  n: number,
  legMin: (i: number, j: number) => number,
  opts?: {
    staticLeg?: (i: number, j: number) => number;
    source?: 'google' | 'dummy';
    /** 推定値で補完した区間を指定する（T-07用） */
    estimatedLeg?: (i: number, j: number) => boolean;
  }
): TravelMatrix {
  const size = n + 2;
  const minutes = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => (i === j ? 0 : legMin(i, j)))
  );
  const staticMinutes = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) =>
      i === j ? 0 : opts?.staticLeg ? opts.staticLeg(i, j) : legMin(i, j)
    )
  );
  const km = minutes.map((row) => row.map((v) => Math.round(v * 0.4 * 10) / 10));
  const estimated = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => (i === j ? false : opts?.estimatedLeg?.(i, j) ?? false))
  );
  return {
    minutes, staticMinutes, km, estimated,
    source: opts?.source ?? 'google',
    routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
    departureTimeIso: new Date().toISOString(),
  };
}

/** すべての区間が一定分数のマトリクス */
export const uniform = (n: number, min: number) => matrix(n, () => min);

export function input(p: {
  members: Member[]; depart: string; arriveBy: string; vehicleId?: string;
}): RouteInput {
  return {
    start: FACILITY,
    end: FACILITY,
    members: p.members,
    departMin: toMin(p.depart),
    facilityArriveBy: toMin(p.arriveBy),
    vehicleId: p.vehicleId ?? 'car-a',
  };
}

export const hasError = (issues: { level: string }[]) => issues.some((i) => i.level === 'error');
export const titles = (issues: { title: string }[]) => issues.map((i) => i.title);
