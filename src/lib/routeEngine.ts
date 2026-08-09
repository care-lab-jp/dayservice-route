/**
 * ルート計算エンジン（地図APIに依存しない純粋ロジック）
 *
 * ・移動時間は TravelMatrix として外から受け取る
 * ・「最短距離」ではなく「希望時間に間に合うか」を重視した評価関数
 * ・巡回順は 最近傍法 -> 2-opt改善 のシンプルな構成（MVPとして十分な精度）
 */
import type { LatLng, Member, RouteIssue, RoutePlan, Stop } from '../types';
import type { TravelMatrix } from './travelProvider';
import { toHHMM, toMin } from './time';

/** 評価関数の重み（現場の感覚に合わせて調整可能） */
export const WEIGHTS = {
  /** 希望時間に遅れる 1分あたりのペナルティ（移動1分の何倍嫌か） */
  latePenalty: 12,
  /**
   * 「遅れた人が1人でもいる」こと自体のペナルティ。
   * これが無いと、1人を20分待たせる案と4人を5分ずつ待たせる案が同点になってしまう。
   * 現場では“遅れる人数を減らす”方が望ましいため固定費を課す。
   */
  lateFixedPenalty: 30,
  /** 早く着きすぎて待つ 1分あたりのペナルティ */
  waitPenalty: 0.6,
  /** 施設への到着希望に遅れる 1分あたりのペナルティ */
  facilityLatePenalty: 8,
  /** 車内滞在が上限を超えた 1分あたりのペナルティ（体力面の配慮） */
  rideOverPenalty: 3,
};

/** 車内滞在時間の既定上限（分）。利用者ごとに maxRideMinutes で上書きできる */
export const DEFAULT_MAX_RIDE_MIN = 40;

export interface RouteInput {
  start: LatLng;
  end: LatLng;
  members: Member[];       // 今日の利用者（順不同）
  departMin: number;       // 施設の出発時刻（分）
  facilityArriveBy: number; // 施設への到着希望時刻（分）
  vehicleId: string;
}

/* ---------- 内部: 指定順の時刻シミュレーション ---------- */

interface Sim {
  stops: Stop[];
  returnMin: number;
  lastLegMin: number;
  totalTravelMin: number;
  totalStaticMin: number;
  totalDistanceKm: number;
  cost: number;
  facilityLateMin: number;
  rideOverTotal: number;
}

function anonId(i: number): string {
  // 利用者A, 利用者B ... AA, AB ... （地図・外部API用の匿名ID）
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let s = '';
  let n = i;
  do {
    s = A[n % 26] + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `利用者${s}`;
}

function simulate(input: RouteInput, tm: TravelMatrix, order: number[]): Sim {
  const matrix = tm.minutes;
  const kmM = tm.km;
  const stM = tm.staticMinutes;
  const estM = tm.estimated;
  // matrix の index: 0 = 出発地, 1..n = members[i-1], n+1 = 帰着地
  const { members, departMin } = input;
  let cur = departMin;
  let prev = 0;
  let totalTravel = 0;
  let totalStatic = 0;
  let cost = 0;
  const stops: Stop[] = [];

  order.forEach((mi, idx) => {
    const m = members[mi];
    const travel = matrix[prev][mi + 1];
    totalTravel += travel;
    totalStatic += stM?.[prev]?.[mi + 1] ?? travel;
    let arrive = cur + travel;

    const from = toMin(m.pickupFrom);
    const to = toMin(m.pickupTo);

    // 希望開始より早く着いたら待つ（利用者を待たせない = 玄関で待たせない配慮）
    const wait = Math.max(0, from - arrive);
    if (wait > 0) arrive = from;
    const late = Math.max(0, arrive - to);

    const board = Math.max(0, m.boardingMinutes || 0);
    const depart = arrive + board;

    stops.push({
      memberId: m.id,
      anonId: anonId(mi),
      order: idx + 1,
      arriveMin: arrive,
      departMin: depart,
      travelMin: travel,
      waitMin: wait,
      lateMin: late,
      distanceKm: kmM?.[prev]?.[mi + 1],
      staticTravelMin: stM?.[prev]?.[mi + 1] ?? travel,
      estimated: estM?.[prev]?.[mi + 1] ?? false,
      trafficDelayMin: Math.max(0, travel - (stM?.[prev]?.[mi + 1] ?? travel)),
    });

    cost +=
      travel +
      late * WEIGHTS.latePenalty +
      (late > 0 ? WEIGHTS.lateFixedPenalty : 0) +
      wait * WEIGHTS.waitPenalty;
    cur = depart;
    prev = mi + 1;
  });

  const lastLeg = matrix[prev][members.length + 1];
  totalTravel += lastLeg;
  totalStatic += stM?.[prev]?.[members.length + 1] ?? lastLeg;
  const returnMin = cur + lastLeg;
  const facilityLate = Math.max(0, returnMin - input.facilityArriveBy);
  cost += lastLeg + facilityLate * WEIGHTS.facilityLatePenalty;

  // 車内滞在時間は「施設に着いた時刻」が決まってから確定する
  let rideOverTotal = 0;
  stops.forEach((st) => {
    const m = members.find((x) => x.id === st.memberId)!;
    st.rideMin = Math.max(0, returnMin - st.departMin);
    const limit = m.maxRideMinutes ?? DEFAULT_MAX_RIDE_MIN;
    const over = Math.max(0, st.rideMin - limit);
    rideOverTotal += over;
    cost += over * WEIGHTS.rideOverPenalty;
  });

  return {
    stops,
    returnMin,
    lastLegMin: lastLeg,
    totalTravelMin: totalTravel,
    totalStaticMin: totalStatic,
    totalDistanceKm:
      Math.round(
        (stops.reduce((a, s) => a + (s.distanceKm ?? 0), 0) + (kmM?.[prev]?.[members.length + 1] ?? 0)) * 10
      ) / 10,
    cost,
    facilityLateMin: facilityLate,
    rideOverTotal,
  };
}

/* ---------- 巡回順の最適化 ---------- */

/**
 * 最近傍法。firstIndex を指定すると、その利用者を1件目に固定して構築する。
 * 1つの初期解だけだと局所最適に落ちやすいため、複数の初期解を作るために使う。
 */
function nearestNeighborOrder(input: RouteInput, tm: TravelMatrix, firstIndex?: number): number[] {
  const matrix = tm.minutes;
  const n = input.members.length;
  const used = new Array(n).fill(false);
  const order: number[] = [];
  let cur = 0;
  let clock = input.departMin;

  if (firstIndex !== undefined && firstIndex >= 0 && firstIndex < n) {
    used[firstIndex] = true;
    order.push(firstIndex);
    clock =
      Math.max(clock + matrix[0][firstIndex + 1], toMin(input.members[firstIndex].pickupFrom)) +
      Math.max(0, input.members[firstIndex].boardingMinutes || 0);
    cur = firstIndex + 1;
  }

  for (let k = order.length; k < n; k++) {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const t = matrix[cur][i + 1];
      const arrive = clock + t;
      const to = toMin(input.members[i].pickupTo);
      const from = toMin(input.members[i].pickupFrom);
      const late = Math.max(0, arrive - to);
      const wait = Math.max(0, from - arrive);
      const score = t + late * WEIGHTS.latePenalty + wait * WEIGHTS.waitPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    used[best] = true;
    order.push(best);
    const t = matrix[cur][best + 1];
    clock = Math.max(clock + t, toMin(input.members[best].pickupFrom)) +
      Math.max(0, input.members[best].boardingMinutes || 0);
    cur = best + 1;
  }
  return order;
}

function twoOpt(input: RouteInput, matrix: TravelMatrix, start: number[]): number[] {
  let best = start.slice();
  let bestCost = simulate(input, matrix, best).cost;
  const n = best.length;
  let improved = true;
  let guard = 0;

  while (improved && guard++ < 60) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const cand = best.slice();
        // 区間反転
        const seg = cand.slice(i, j + 1).reverse();
        cand.splice(i, seg.length, ...seg);
        const c = simulate(input, matrix, cand).cost;
        if (c < bestCost - 1e-9) {
          best = cand;
          bestCost = c;
          improved = true;
        }
      }
    }
    // or-opt（1件を別位置へ移動）
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const cand = best.slice();
        const [x] = cand.splice(i, 1);
        cand.splice(j, 0, x);
        const c = simulate(input, matrix, cand).cost;
        if (c < bestCost - 1e-9) {
          best = cand;
          bestCost = c;
          improved = true;
        }
      }
    }
  }
  return best;
}

/**
 * 複数の初期解から改善を回して最良を選ぶ（多点スタート）。
 * 単一の最近傍解だけでは、希望時間の並びによっては明らかに悪い順番に落ち込むことがある。
 * 人数が多いときは計算量を抑えるため初期解の数を絞る。
 */
export function searchBestOrder(input: RouteInput, matrix: TravelMatrix): number[] {
  const n = input.members.length;
  if (n <= 1) return n === 1 ? [0] : [];

  const seeds: (number | undefined)[] = [undefined];
  if (n <= 12) {
    for (let i = 0; i < n; i++) seeds.push(i);
  } else {
    // 希望終了時刻が早い順に4件を初期候補にする（締切が厳しい人から回る案）
    const byDeadline = input.members
      .map((m, i) => ({ i, to: toMin(m.pickupTo) }))
      .sort((a, b) => a.to - b.to)
      .slice(0, 4)
      .map((x) => x.i);
    seeds.push(...byDeadline);
  }

  let best: number[] | null = null;
  let bestCost = Infinity;
  for (const seed of seeds) {
    const nn = nearestNeighborOrder(input, matrix, seed);
    const improved = twoOpt(input, matrix, nn);
    const c = simulate(input, matrix, improved).cost;
    if (c < bestCost - 1e-9) {
      bestCost = c;
      best = improved;
    }
  }
  return best ?? [];
}

/* ---------- 警告の生成 ---------- */

function buildIssues(input: RouteInput, sim: Sim): RouteIssue[] {
  const issues: RouteIssue[] = [];
  const nameOf = (id: string) => input.members.find((m) => m.id === id)?.name ?? '';

  const lateStops = sim.stops.filter((s) => s.lateMin > 0);
  if (lateStops.length > 0) {
    const worst = Math.max(...lateStops.map((s) => s.lateMin));
    issues.push({
      level: 'error',
      title: '時間制約を満たせません',
      detail:
        lateStops
          .map((s) => `${nameOf(s.memberId)}さんへの到着が約${s.lateMin}分遅れる可能性があります。`)
          .join('\n'),
      suggestions: [
        `出発時刻を${worst}分以上早める（${toHHMM(input.departMin - worst)}出発）`,
        '順番を手動で入れ替える（下のリストで並べ替えできます）',
        '一部の利用者を別車両に分ける',
        'お迎え希望時間を見直す',
      ],
    });
  }

  if (sim.facilityLateMin > 0) {
    issues.push({
      level: 'error',
      title: '施設への到着が遅れます',
      detail: `施設到着が ${toHHMM(sim.returnMin)} となり、希望の ${toHHMM(
        input.facilityArriveBy
      )} より約${sim.facilityLateMin}分遅れます。`,
      suggestions: [
        `出発時刻を${sim.facilityLateMin}分早める`,
        '利用者を2便に分ける',
        '施設到着希望時刻を見直す',
      ],
    });
  }

  // 車内滞在が長すぎる利用者（体調面の配慮。現場では重要な観点）
  const longRide = sim.stops.filter((s) => {
    const m = input.members.find((x) => x.id === s.memberId);
    const limit = m?.maxRideMinutes ?? DEFAULT_MAX_RIDE_MIN;
    return (s.rideMin ?? 0) > limit;
  });
  if (longRide.length > 0) {
    issues.push({
      level: 'warning',
      title: '車内での乗車時間が長くなります',
      detail: longRide
        .map((s) => {
          const m = input.members.find((x) => x.id === s.memberId);
          const limit = m?.maxRideMinutes ?? DEFAULT_MAX_RIDE_MIN;
          return `${nameOf(s.memberId)}さんの車内時間が約${s.rideMin}分です（目安${limit}分）。`;
        })
        .join('\n'),
      suggestions: [
        '順番を後ろにずらす（施設に近い時間で乗ってもらう）',
        '別の便に分ける',
        'その方の乗車時間の上限設定を見直す',
      ],
    });
  }

  const bigWait = sim.stops.filter((s) => s.waitMin >= 8);
  if (bigWait.length > 0) {
    issues.push({
      level: 'warning',
      title: '待ち時間が長い箇所があります',
      detail: bigWait
        .map((s) => `${nameOf(s.memberId)}さん宅で約${s.waitMin}分の待機が発生します。`)
        .join('\n'),
      suggestions: ['出発時刻を少し遅らせる', '順番を入れ替える'],
    });
  }

  const jam = sim.stops.filter((s) => (s.trafficDelayMin ?? 0) >= 5);
  if (jam.length > 0) {
    issues.push({
      level: 'warning',
      title: '渋滞の影響が見込まれます',
      detail: jam
        .map((s) => `${nameOf(s.memberId)}さんまでの区間で通常より約${s.trafficDelayMin}分余計にかかる見込みです。`)
        .join('\n'),
      suggestions: ['出発時刻を早める', '順番を入れ替える', '当日の交通状況を再確認する'],
    });
  }

  if (issues.length === 0) {
    issues.push({
      level: 'info',
      title: 'すべての希望時間に間に合います',
      detail: `施設到着予定 ${toHHMM(sim.returnMin)}（希望 ${toHHMM(input.facilityArriveBy)}）`,
      suggestions: [],
    });
  }
  return issues;
}

/* ---------- 公開API ---------- */

/** 自動でよい巡回順を作り、時刻を計算して返す */
export function buildOptimizedPlan(input: RouteInput, matrix: TravelMatrix): RoutePlan {
  if (input.members.length === 0) {
    return {
      vehicleId: input.vehicleId,
      departMin: input.departMin,
      stops: [],
      returnMin: input.departMin,
      lastLegMin: 0,
      totalTravelMin: 0,
      issues: [],
      travelSource: matrix.source,
      createdAt: new Date().toISOString(),
    };
  }
  const order = searchBestOrder(input, matrix);
  return planFromOrder(input, matrix, order);
}

/** 指定された順番（手動並べ替え後など）で時刻を再計算する */
export function planFromOrder(
  input: RouteInput,
  matrix: TravelMatrix,
  order: number[]
): RoutePlan {
  const sim = simulate(input, matrix, order);
  const rec = recommendBestDepart(input, matrix, order);
  return {
    vehicleId: input.vehicleId,
    departMin: input.departMin,
    stops: sim.stops,
    returnMin: sim.returnMin,
    lastLegMin: sim.lastLegMin,
    totalTravelMin: sim.totalTravelMin,
    totalDistanceKm: sim.totalDistanceKm || undefined,
    staticTravelMin: sim.totalStaticMin,
    estimatedLegCount:
      sim.stops.filter((s) => s.estimated).length + (tmEstimatedLastLeg(input, matrix, order) ? 1 : 0),
    trafficDelayMin: Math.max(0, sim.totalTravelMin - sim.totalStaticMin),
    departureTimeIso: matrix.departureTimeIso,
    routingPreference: matrix.routingPreference,
    recommendedDepartMin: rec.min,
    recommendedDepartReason: rec.reason,
    latestDepartMin: suggestDepartMin(input, matrix, order),
    issues: buildIssues(input, sim),
    travelSource: matrix.source,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 指定順の評価値を返す（テスト・デバッグ・重み調整用）。
 * 画面からは使わないが、コスト関数の妥当性を検証できるようにしておく。
 */
export function evaluateOrder(input: RouteInput, matrix: TravelMatrix, order: number[]) {
  const sim = simulate(input, matrix, order);
  return {
    cost: sim.cost,
    totalTravelMin: sim.totalTravelMin,
    returnMin: sim.returnMin,
    facilityLateMin: sim.facilityLateMin,
    lateCount: sim.stops.filter((s) => s.lateMin > 0).length,
    totalLateMin: sim.stops.reduce((a, s) => a + s.lateMin, 0),
    totalWaitMin: sim.stops.reduce((a, s) => a + s.waitMin, 0),
    rideOverTotal: sim.rideOverTotal,
  };
}

/**
 * おすすめ出発時刻を求める。
 * ・全員の希望時間に間に合い、施設到着にも間に合う案の中から、コスト最小（＝待機も少ない）を選ぶ
 * ・実現不能なら、最もマシな案を返しつつ reason='impossible' を返す
 * 探索範囲は現在の設定から −90分 〜 +30分（1分刻み）。
 */
export function recommendBestDepart(
  input: RouteInput,
  matrix: TravelMatrix,
  order: number[]
): { min: number; reason: 'ok' | 'earlier' | 'later' | 'impossible' } {
  if (order.length === 0) return { min: input.departMin, reason: 'ok' };

  let feasibleBest: { min: number; cost: number } | null = null;
  let anyBest: { min: number; cost: number } | null = null;

  // 0時をまたぐ表示崩れを防ぐため下限をクランプし、待機解消側は+60分まで見る
  const lo = Math.max(-90, -input.departMin);
  for (let d = lo; d <= 60; d++) {
    const cand = { ...input, departMin: input.departMin + d };
    const sim = simulate(cand, matrix, order);
    const feasible = sim.stops.every((s) => s.lateMin === 0) && sim.facilityLateMin === 0;
    if (!anyBest || sim.cost < anyBest.cost - 1e-9) anyBest = { min: cand.departMin, cost: sim.cost };
    // 同コストなら「現在の設定に最も近い時刻」を採る。
    // （わずかな差で毎回ちがう時刻を勧めると、職員の信頼を損なうため）
    if (feasible) {
      const better =
        !feasibleBest ||
        sim.cost < feasibleBest.cost - 1e-9 ||
        (Math.abs(sim.cost - feasibleBest.cost) <= 1e-9 &&
          Math.abs(cand.departMin - input.departMin) < Math.abs(feasibleBest.min - input.departMin));
      if (better) feasibleBest = { min: cand.departMin, cost: sim.cost };
    }
  }

  if (!feasibleBest) return { min: anyBest!.min, reason: 'impossible' };
  if (feasibleBest.min === input.departMin) return { min: feasibleBest.min, reason: 'ok' };
  return { min: feasibleBest.min, reason: feasibleBest.min < input.departMin ? 'earlier' : 'later' };
}

/** 最終区間（最後の利用者 -> 施設）が推定値かどうか */
function tmEstimatedLastLeg(input: RouteInput, matrix: TravelMatrix, order: number[]): boolean {
  if (order.length === 0) return false;
  const last = order[order.length - 1] + 1;
  return matrix.estimated?.[last]?.[input.members.length + 1] ?? false;
}

/** memberId の並びから order（members配列のindex列）を作る */
export function orderFromMemberIds(members: Member[], memberIds: string[]): number[] {
  return memberIds
    .map((id) => members.findIndex((m) => m.id === id))
    .filter((i) => i >= 0);
}

/** 全員の希望時間に間に合う「推奨出発時刻」を逆算（1分刻みで探索） */
export function suggestDepartMin(
  input: RouteInput,
  matrix: TravelMatrix,
  order: number[]
): number | null {
  for (let d = 0; d <= 120; d++) {
    const cand = { ...input, departMin: input.departMin - d };
    const sim = simulate(cand, matrix, order);
    const ok = sim.stops.every((s) => s.lateMin === 0) && sim.facilityLateMin === 0;
    if (ok) return cand.departMin;
  }
  return null;
}
