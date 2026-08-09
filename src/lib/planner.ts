/**
 * 画面とエンジンをつなぐ層。
 * ・出発予定時刻を Routes API の departureTime として渡し、その時刻の交通状況で計算する
 * ・移動時間マトリクスをキャッシュ（手動並べ替えのたびに再課金しない）
 * ・Google連携時は、決まった順番のルート形状＋渋滞区間も取得して地図描画に渡す
 * ・複数車両へ拡張できるよう、結果は DayPlan（routes[]）にまとめて返す
 */
import type { DayPlan, Facility, LatLng, Member, RoutePlan, Vehicle } from '../types';
import { createTravelProvider, hasGoogleKey, type TravelMatrix } from './travelProvider';
import { tryFetchRouteShape } from './googleRoutes';
import {
  buildOptimizedPlan, orderFromMemberIds, planFromOrder, suggestDepartMin, type RouteInput,
} from './routeEngine';
import { toMin } from './time';
import { currentTenant } from './tenant';
import { buildSnapshot, todayKey } from './freshness';

interface Cache { key: string; matrix: TravelMatrix }
let cache: Cache | null = null;

/** 施設や利用者の座標・出発時刻を変えたときにキャッシュを捨てる */
export function clearMatrixCache() { cache = null; }

/** "HH:MM" を今日の Date に変換（交通予測の基準時刻） */
export function departureDate(departTime: string, base = new Date()): Date {
  const d = new Date(base);
  const [h, m] = departTime.split(':').map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function makeInput(
  facility: Facility, members: Member[], departTime: string, vehicleId: string
): RouteInput {
  return {
    start: facility.startPoint ?? { lat: facility.lat, lng: facility.lng },
    end: facility.endPoint ?? { lat: facility.lat, lng: facility.lng },
    members,
    departMin: toMin(departTime),
    facilityArriveBy: toMin(facility.arriveBy),
    vehicleId,
  };
}

async function ensureMatrix(input: RouteInput, departTime: string): Promise<TravelMatrix> {
  // 交通状況は出発時刻で変わるため、時刻もキャッシュキーに含める（15分単位で丸める）
  const bucket = Math.floor(toMin(departTime) / 15);
  const useTraffic = currentTenant()?.useTraffic !== false;
  const key = JSON.stringify([
    input.start, input.end, input.members.map((m) => [m.id, m.lat, m.lng]), bucket, useTraffic,
  ]);
  if (cache && cache.key === key) return cache.matrix;

  const provider = createTravelProvider();
  const points: LatLng[] = [
    input.start, ...input.members.map((m) => ({ lat: m.lat, lng: m.lng })), input.end,
  ];
  const matrix = await provider.getMatrix(points, {
    departureTime: departureDate(departTime),
    useTraffic,
  });
  cache = { key, matrix };
  return matrix;
}

/** 決まった順番の実道路ルート形状＋渋滞区間を取り、planに合成する（失敗しても plan は返る） */
async function attachShape(
  plan: RoutePlan, input: RouteInput, matrix: TravelMatrix, departTime: string
): Promise<RoutePlan> {
  if (!hasGoogleKey() || matrix.source !== 'google' || plan.stops.length === 0) return plan;
  // 削除済みの利用者が混ざっていても落ちないようにする
  const coords = plan.stops
    .map((s) => input.members.find((x) => x.id === s.memberId))
    .filter((m): m is Member => !!m)
    .map((m) => ({ lat: m.lat, lng: m.lng }));
  if (coords.length !== plan.stops.length) return plan;
  const { shape } = await tryFetchRouteShape(
    input.start, coords, input.end, departureDate(departTime),
    currentTenant()?.useTraffic !== false
  );
  if (!shape) return plan;
  return {
    ...plan,
    encodedPolyline: shape.encodedPolyline,
    trafficIntervals: shape.trafficIntervals,
    totalDistanceKm: shape.totalKm || plan.totalDistanceKm,
    departureTimeIso: shape.departureTimeIso ?? plan.departureTimeIso,
  };
}

/* ---------------- 1車両ぶんの計算 ---------------- */

/** 自動最適化してルートを作る（交通状況を考慮した移動時間で巡回順を決定） */
export async function createPlan(
  facility: Facility, members: Member[], departTime: string, vehicleId: string
): Promise<RoutePlan> {
  const input = makeInput(facility, members, departTime, vehicleId);
  const matrix = await ensureMatrix(input, departTime);
  const plan = buildOptimizedPlan(input, matrix);
  return attachShape(plan, input, matrix, departTime);
}

/** 手動で並べ替えた順番で時刻を再計算する */
export async function recalcPlan(
  facility: Facility, members: Member[], departTime: string, vehicleId: string, memberIdOrder: string[]
): Promise<RoutePlan> {
  const input = makeInput(facility, members, departTime, vehicleId);
  const matrix = await ensureMatrix(input, departTime);
  const plan = planFromOrder(input, matrix, orderFromMemberIds(members, memberIdOrder));
  return attachShape(plan, input, matrix, departTime);
}

/** 全員に間に合う推奨出発時刻（分）。見つからなければ null */
export async function recommendDepart(
  facility: Facility, members: Member[], departTime: string, vehicleId: string, memberIdOrder: string[]
): Promise<number | null> {
  const input = makeInput(facility, members, departTime, vehicleId);
  const matrix = await ensureMatrix(input, departTime);
  return suggestDepartMin(input, matrix, orderFromMemberIds(members, memberIdOrder));
}

/* ---------------- 複数車両への拡張ポイント ---------------- */

/** 車両とメンバー構成の適合チェック（画面の事前警告とテストで共用） */
export type FitIssueCode = 'CAPACITY' | 'WHEELCHAIR';
export interface FitIssue { code: FitIssueCode; message: string }

export function checkVehicleFit(members: Member[], vehicle?: Vehicle): FitIssue[] {
  const issues: FitIssue[] = [];
  if (!vehicle) return issues;
  if (members.length > vehicle.capacity) {
    issues.push({
      code: 'CAPACITY',
      message: `${vehicle.name}の定員（${vehicle.capacity}名）に対して${members.length}名が選択されています。`,
    });
  }
  const wc = members.filter((m) => m.requiresWheelchair);
  if (wc.length > 0 && !vehicle.wheelchair) {
    issues.push({
      code: 'WHEELCHAIR',
      message: `${vehicle.name}は車いす非対応ですが、車いすの方が${wc.length}名含まれています。`,
    });
  }
  return issues;
}

/**
 * 利用者を車両へ割り当てる。
 * ・稼働車両が1台なら全員をそこへ（MVPの既定）
 * ・複数台なら「車いすの方を対応車両へ優先」→「定員に収まるよう配分」
 * ここを差し替えれば、エリア分割や乗車時間の均等化へ拡張できる。
 */
export function assignMembersToVehicles(
  members: Member[], vehicles: Vehicle[]
): { vehicle: Vehicle; members: Member[] }[] {
  const active = vehicles.filter((v) => v.active);
  if (active.length <= 1) {
    return [{ vehicle: active[0] ?? vehicles[0], members }];
  }

  const groups = active.map((v) => ({ vehicle: v, members: [] as Member[] }));
  const wcGroups = groups.filter((g) => g.vehicle.wheelchair);
  const room = (g: { vehicle: Vehicle; members: Member[] }) => g.vehicle.capacity - g.members.length;

  // 1) 車いすの方を対応車両へ（空きの多い順）
  for (const m of members.filter((x) => x.requiresWheelchair)) {
    const target = [...(wcGroups.length ? wcGroups : groups)].sort((a, b) => room(b) - room(a))[0];
    target.members.push(m);
  }
  // 2) 残りを空きの多い車両へ順に
  for (const m of members.filter((x) => !x.requiresWheelchair)) {
    const target = [...groups].sort((a, b) => room(b) - room(a))[0];
    target.members.push(m);
  }
  return groups.filter((g) => g.members.length > 0);
}

/** 1日分（＝全車両分）の送迎計画を作る */
/**
 * 前回の巡回順を、今日の利用者に合わせて適用できる形へ変換する。
 * ・今日休みの人は取り除く
 * ・前回いなかった人は末尾に足す（順番は自動最適化の結果を維持）
 * 「人数が違うと何も起きない」という無反応をなくすための関数。
 */
export function adaptPreviousOrder(
  previousOrder: string[], todaysMemberIds: string[]
): { order: string[]; removed: string[]; added: string[] } {
  const today = new Set(todaysMemberIds);
  const kept = previousOrder.filter((id) => today.has(id));
  const removed = previousOrder.filter((id) => !today.has(id));
  const added = todaysMemberIds.filter((id) => !previousOrder.includes(id));
  return { order: [...kept, ...added], removed, added };
}

/** 計算中の並べ替えを無視するためのガード（結果の上書き事故を防ぐ） */
export function reorderIfAllowed(
  busy: boolean, order: string[], from: number, to: number
): string[] | null {
  if (busy) return null;
  if (from === to) return null;
  if (from < 0 || to < 0 || from >= order.length || to >= order.length) return null;
  const next = order.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

export async function createDayPlan(
  facility: Facility, members: Member[], departTime: string, vehicles: Vehicle[]
): Promise<DayPlan> {
  const groups = assignMembersToVehicles(members, vehicles);
  const routes: RoutePlan[] = [];
  for (const g of groups) {
    routes.push(await createPlan(facility, g.members, departTime, g.vehicle.id));
  }
  const now = new Date();
  return {
    tenantId: currentTenant().id,
    facilityId: facility.id,
    date: todayKey(now),
    departTime,
    memberIds: members.map((m) => m.id),
    // 作成時点の設定を記録しておき、あとで「現状と一致しているか」を判定できるようにする
    snapshot: buildSnapshot(facility, members, vehicles, departTime),
    routes,
    createdAt: now.toISOString(),
  };
}
