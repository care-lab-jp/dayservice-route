/**
 * デイサービス送迎を想定したシナリオテスト（実APIは呼ばない）。
 * 移動時間はテスト側でマトリクスを与えるため、結果は完全に再現可能。
 */
import { describe, expect, it } from 'vitest';
import {
  buildOptimizedPlan, planFromOrder, orderFromMemberIds,
  recommendBestDepart, suggestDepartMin, searchBestOrder, evaluateOrder, DEFAULT_MAX_RIDE_MIN,
} from '../routeEngine';
import { toHHMM, toMin } from '../time';
import { hasError, input, matrix, member, titles, uniform } from './helpers';

const nameOrder = (plan: { stops: { memberId: string }[] }, members: { id: string; name: string }[]) =>
  plan.stops.map((s) => members.find((m) => m.id === s.memberId)!.name);

describe('01 基本ケース', () => {
  it('全員が余裕で間に合う場合はエラーが出ない', () => {
    const ms = [
      member({ name: '田中', pickupFrom: '08:00', pickupTo: '09:00' }),
      member({ name: '山田', pickupFrom: '08:00', pickupTo: '09:00' }),
      member({ name: '鈴木', pickupFrom: '08:00', pickupTo: '09:00' }),
    ];
    const plan = buildOptimizedPlan(input({ members: ms, depart: '08:00', arriveBy: '09:30' }), uniform(3, 5));
    expect(hasError(plan.issues)).toBe(false);
    expect(titles(plan.issues)).toContain('すべての希望時間に間に合います');
    expect(plan.stops).toHaveLength(3);
  });

  it('利用者0名でも落ちない', () => {
    const plan = buildOptimizedPlan(input({ members: [], depart: '08:00', arriveBy: '09:00' }), uniform(0, 5));
    expect(plan.stops).toHaveLength(0);
    expect(plan.returnMin).toBe(toMin('08:00'));
  });

  it('利用者1名の最小ケース', () => {
    const ms = [member({ name: '田中' })];
    const plan = buildOptimizedPlan(input({ members: ms, depart: '08:00', arriveBy: '09:00' }), uniform(1, 7));
    expect(toHHMM(plan.stops[0].arriveMin)).toBe('08:07');
    expect(toHHMM(plan.returnMin)).toBe('08:17'); // 07 + 乗車3分 + 帰り7分
  });
});

describe('02 希望時間の扱い', () => {
  it('希望時間が重なっていても締切の早い人から回る', () => {
    // 各区間6分・乗車3分。この締切では「山田→鈴木→田中」だけが全員間に合う
    const ms = [
      member({ name: '田中', pickupFrom: '08:00', pickupTo: '08:30' }),
      member({ name: '山田', pickupFrom: '08:00', pickupTo: '08:08' }),
      member({ name: '鈴木', pickupFrom: '08:00', pickupTo: '08:18' }),
    ];
    const plan = buildOptimizedPlan(input({ members: ms, depart: '08:00', arriveBy: '09:30' }), uniform(3, 6));
    expect(nameOrder(plan, ms)).toEqual(['山田', '鈴木', '田中']);
    expect(hasError(plan.issues)).toBe(false);
  });

  it('一人だけ時間制約が厳しい場合、その人が先頭に来る', () => {
    const ms = [
      member({ name: '田中', pickupFrom: '08:00', pickupTo: '09:00' }),
      member({ name: '山田', pickupFrom: '08:00', pickupTo: '09:00' }),
      member({ name: '急ぎ', pickupFrom: '08:00', pickupTo: '08:10' }),
    ];
    const plan = buildOptimizedPlan(input({ members: ms, depart: '08:00', arriveBy: '09:30' }), uniform(3, 8));
    expect(nameOrder(plan, ms)[0]).toBe('急ぎ');
  });

  it('早着すると希望開始時刻まで待機になる', () => {
    const ms = [member({ name: '田中', pickupFrom: '08:30', pickupTo: '09:00' })];
    const plan = buildOptimizedPlan(input({ members: ms, depart: '08:00', arriveBy: '09:30' }), uniform(1, 5));
    expect(plan.stops[0].waitMin).toBe(25);
    expect(toHHMM(plan.stops[0].arriveMin)).toBe('08:30');
  });

  it('待機が8分以上あると注意が出る', () => {
    const ms = [member({ name: '田中', pickupFrom: '08:20', pickupTo: '09:00' })];
    const plan = buildOptimizedPlan(input({ members: ms, depart: '08:00', arriveBy: '09:30' }), uniform(1, 5));
    expect(titles(plan.issues)).toContain('待ち時間が長い箇所があります');
  });

  it('乗車時間補正が停車時間として加算される', () => {
    const ms = [member({ name: '車いす', boardingMinutes: 9, pickupFrom: '08:00', pickupTo: '09:00' })];
    const plan = buildOptimizedPlan(input({ members: ms, depart: '08:00', arriveBy: '09:30' }), uniform(1, 5));
    expect(plan.stops[0].departMin - plan.stops[0].arriveMin).toBe(9);
  });
});

describe('03 間に合わないケース', () => {
  it('全員を時間内に迎えられない場合はエラーになる', () => {
    const ms = [
      member({ name: '田中', pickupFrom: '08:00', pickupTo: '08:10' }),
      member({ name: '山田', pickupFrom: '08:00', pickupTo: '08:10' }),
      member({ name: '鈴木', pickupFrom: '08:00', pickupTo: '08:10' }),
    ];
    const plan = buildOptimizedPlan(input({ members: ms, depart: '08:00', arriveBy: '09:30' }), uniform(3, 15));
    expect(hasError(plan.issues)).toBe(true);
    expect(titles(plan.issues)).toContain('時間制約を満たせません');
    expect(plan.stops.filter((s) => s.lateMin > 0).length).toBeGreaterThan(0);
  });

  it('施設への到着希望に間に合わない場合はエラーになる', () => {
    const ms = [
      member({ name: '田中', pickupFrom: '07:00', pickupTo: '10:00' }),
      member({ name: '山田', pickupFrom: '07:00', pickupTo: '10:00' }),
    ];
    const plan = buildOptimizedPlan(input({ members: ms, depart: '08:00', arriveBy: '08:30' }), uniform(2, 20));
    expect(titles(plan.issues)).toContain('施設への到着が遅れます');
  });

  it('総遅延が同じなら「遅れる人数が少ない案」を選ぶ（固定ペナルティの効果）', () => {
    // どちらの順でも総遅延は12分。ただし A案=1人が12分遅れ、B案=2人が2分と10分遅れ。
    const ms = [
      member({ name: '余裕', pickupFrom: '07:00', pickupTo: '08:10', boardingMinutes: 0 }),
      member({ name: '厳しい', pickupFrom: '07:00', pickupTo: '08:08', boardingMinutes: 0 }),
    ];
    const inp = input({ members: ms, depart: '08:00', arriveBy: '10:00' });
    const m = uniform(2, 10);

    const a = evaluateOrder(inp, m, [0, 1]); // 余裕→厳しい : 厳しいだけ12分遅れ
    const b = evaluateOrder(inp, m, [1, 0]); // 厳しい→余裕 : 2人が2分と10分遅れ
    expect(a.totalLateMin).toBe(b.totalLateMin);
    expect(a.lateCount).toBe(1);
    expect(b.lateCount).toBe(2);
    expect(a.cost).toBeLessThan(b.cost);

    const plan = buildOptimizedPlan(inp, m);
    expect(plan.stops.filter((s) => s.lateMin > 0)).toHaveLength(1);
  });
});

describe('04 交通状況', () => {
  it('渋滞区間があると増加分が記録され注意が出る', () => {
    const ms = [
      member({ name: '田中', pickupFrom: '08:00', pickupTo: '09:00' }),
      member({ name: '山田', pickupFrom: '08:00', pickupTo: '09:00' }),
    ];
    // 施設(0) -> 田中(1) の区間だけ通常5分が15分になる
    const m = matrix(2, (i, j) => (i === 0 && j === 1 ? 15 : 5), { staticLeg: () => 5 });
    const plan = planFromOrder(
      input({ members: ms, depart: '08:00', arriveBy: '09:30' }), m, [0, 1]
    );
    expect(plan.stops[0].trafficDelayMin).toBe(10);
    expect(plan.trafficDelayMin).toBe(10);
    expect(titles(plan.issues)).toContain('渋滞の影響が見込まれます');
  });

  it('渋滞を考慮すると巡回順が変わる（距離ではなく実所要で判断）', () => {
    const ms = [
      member({ name: '近いが渋滞', pickupFrom: '08:00', pickupTo: '09:00' }),
      member({ name: '遠いが順調', pickupFrom: '08:00', pickupTo: '09:00' }),
    ];
    // 通常時は 1 の方が近い（3分 vs 8分）が、渋滞で 1 は 25分かかる
    const normal = matrix(2, (i, j) => (i === 0 ? (j === 1 ? 3 : 8) : 5));
    const jam = matrix(2, (i, j) => (i === 0 ? (j === 1 ? 25 : 8) : 5), { staticLeg: (i, j) => (i === 0 ? (j === 1 ? 3 : 8) : 5) });

    const normalPlan = buildOptimizedPlan(input({ members: ms, depart: '08:00', arriveBy: '10:00' }), normal);
    const jamPlan = buildOptimizedPlan(input({ members: ms, depart: '08:00', arriveBy: '10:00' }), jam);
    expect(nameOrder(normalPlan, ms)[0]).toBe('近いが渋滞');
    expect(nameOrder(jamPlan, ms)[0]).toBe('遠いが順調');
  });

  it('デモモード（通常時＝予測）では増加0分', () => {
    const ms = [member({ name: '田中' })];
    const plan = buildOptimizedPlan(
      input({ members: ms, depart: '08:00', arriveBy: '09:30' }), uniform(1, 6)
    );
    expect(plan.trafficDelayMin).toBe(0);
  });
});

describe('05 車内滞在時間', () => {
  it('最初に乗った人の車内時間が長いと注意が出る', () => {
    const ms = [
      member({ name: '先頭', pickupFrom: '08:00', pickupTo: '09:00' }),
      member({ name: '中間', pickupFrom: '08:00', pickupTo: '09:00' }),
      member({ name: '最後', pickupFrom: '08:00', pickupTo: '09:00' }),
    ];
    const plan = planFromOrder(
      input({ members: ms, depart: '08:00', arriveBy: '10:00' }), uniform(3, 18), [0, 1, 2]
    );
    expect(plan.stops[0].rideMin).toBeGreaterThan(DEFAULT_MAX_RIDE_MIN);
    expect(titles(plan.issues)).toContain('車内での乗車時間が長くなります');
  });

  it('その人の上限を延ばせば注意は出ない', () => {
    const ms = [
      member({ name: '先頭', maxRideMinutes: 120 }),
      member({ name: '中間', maxRideMinutes: 120 }),
      member({ name: '最後', maxRideMinutes: 120 }),
    ];
    const plan = planFromOrder(
      input({ members: ms, depart: '08:00', arriveBy: '10:00' }), uniform(3, 18), [0, 1, 2]
    );
    expect(titles(plan.issues)).not.toContain('車内での乗車時間が長くなります');
  });

  it('rideMin は施設到着時刻から逆算される', () => {
    const ms = [member({ name: '田中' }), member({ name: '山田' })];
    const plan = planFromOrder(
      input({ members: ms, depart: '08:00', arriveBy: '10:00' }), uniform(2, 10), [0, 1]
    );
    expect(plan.stops[0].rideMin).toBe(plan.returnMin - plan.stops[0].departMin);
  });
});

describe('06 出発時刻の提案', () => {
  it('遅れているときは「早める」提案になる', () => {
    const ms = [
      member({ name: '田中', pickupFrom: '07:00', pickupTo: '08:05' }),
      member({ name: '山田', pickupFrom: '07:00', pickupTo: '08:20' }),
    ];
    const inp = input({ members: ms, depart: '08:00', arriveBy: '10:00' });
    const m = uniform(2, 10);
    const order = searchBestOrder(inp, m);
    const rec = recommendBestDepart(inp, m, order);
    expect(rec.reason).toBe('earlier');
    expect(rec.min).toBeLessThan(inp.departMin);
  });

  it('早すぎて待機ばかりのときは「遅らせる」提案になる', () => {
    const ms = [
      member({ name: '田中', pickupFrom: '09:00', pickupTo: '09:30' }),
      member({ name: '山田', pickupFrom: '09:00', pickupTo: '09:40' }),
    ];
    const inp = input({ members: ms, depart: '08:00', arriveBy: '11:00' });
    const m = uniform(2, 5);
    const rec = recommendBestDepart(inp, m, searchBestOrder(inp, m));
    expect(rec.reason).toBe('later');
  });

  it('ちょうど良いときは ok', () => {
    const ms = [member({ name: '田中', pickupFrom: '08:05', pickupTo: '08:15' })];
    const inp = input({ members: ms, depart: '08:00', arriveBy: '09:00' });
    const m = uniform(1, 5);
    const rec = recommendBestDepart(inp, m, [0]);
    expect(rec.reason).toBe('ok');
  });

  it('どう調整しても不可能なら impossible', () => {
    const ms = [
      member({ name: '田中', pickupFrom: '08:00', pickupTo: '08:05' }),
      member({ name: '山田', pickupFrom: '08:00', pickupTo: '08:05' }),
    ];
    const inp = input({ members: ms, depart: '08:00', arriveBy: '10:00' });
    const m = uniform(2, 30);
    const rec = recommendBestDepart(inp, m, [0, 1]);
    expect(rec.reason).toBe('impossible');
  });

  it('suggestDepartMin は間に合う最初の時刻を返し、無理なら null', () => {
    const ms = [member({ name: '田中', pickupFrom: '07:00', pickupTo: '08:02' })];
    const inp = input({ members: ms, depart: '08:00', arriveBy: '10:00' });
    expect(suggestDepartMin(inp, uniform(1, 10), [0])).not.toBeNull();

    // 8:00より前には迎えに行けず、片道40分では施設8:05到着が物理的に不可能
    const tight = [member({ name: '田中', pickupFrom: '08:00', pickupTo: '09:00' })];
    const inp2 = input({ members: tight, depart: '08:00', arriveBy: '08:05' });
    expect(suggestDepartMin(inp2, uniform(1, 40), [0])).toBeNull();
  });
});

describe('07 手動並べ替え', () => {
  it('順番を指定すると時刻が矛盾なく再計算される', () => {
    const ms = [
      member({ name: '田中' }), member({ name: '山田' }), member({ name: '鈴木' }),
    ];
    const inp = input({ members: ms, depart: '08:00', arriveBy: '10:00' });
    const m = uniform(3, 7);
    const reversed = planFromOrder(inp, m, orderFromMemberIds(ms, [ms[2].id, ms[1].id, ms[0].id]));
    expect(reversed.stops.map((s) => s.memberId)).toEqual([ms[2].id, ms[1].id, ms[0].id]);
    for (let i = 1; i < reversed.stops.length; i++) {
      expect(reversed.stops[i].arriveMin).toBeGreaterThan(reversed.stops[i - 1].departMin - 1);
    }
    expect(reversed.returnMin).toBeGreaterThan(reversed.stops[2].departMin);
  });

  it('orderFromMemberIds は存在しないIDを無視する', () => {
    const ms = [member({ name: '田中' }), member({ name: '山田' })];
    expect(orderFromMemberIds(ms, ['nope', ms[1].id])).toEqual([1]);
  });
});

describe('08 規模と性能', () => {
  it('利用者15名でも1秒以内に計算できる', () => {
    const ms = Array.from({ length: 15 }, (_, i) =>
      member({ name: `利用者${i}`, pickupFrom: '08:00', pickupTo: '09:30' })
    );
    const m = matrix(15, (i, j) => 3 + (Math.abs(i - j) % 7));
    const t0 = Date.now();
    const plan = buildOptimizedPlan(input({ members: ms, depart: '08:00', arriveBy: '10:30' }), m);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(plan.stops).toHaveLength(15);
  });

  it('多点スタートで単純な最近傍解より悪くならない', () => {
    const ms = Array.from({ length: 8 }, (_, i) =>
      member({ name: `利用者${i}`, pickupFrom: '08:00', pickupTo: '09:00' })
    );
    const m = matrix(8, (i, j) => 2 + ((i * 3 + j * 5) % 11));
    const inp = input({ members: ms, depart: '08:00', arriveBy: '10:00' });
    const best = planFromOrder(inp, m, searchBestOrder(inp, m));
    const naive = planFromOrder(inp, m, ms.map((_, i) => i));
    expect(best.totalTravelMin).toBeLessThanOrEqual(naive.totalTravelMin);
  });
});

describe('09 個人情報', () => {
  it('匿名IDに氏名が含まれない', () => {
    const ms = [member({ name: '田中' }), member({ name: '山田' })];
    const plan = buildOptimizedPlan(input({ members: ms, depart: '08:00', arriveBy: '10:00' }), uniform(2, 5));
    plan.stops.forEach((s) => {
      expect(s.anonId).toMatch(/^利用者[A-Z]+$/);
      expect(s.anonId).not.toContain('田中');
      expect(s.anonId).not.toContain('山田');
    });
  });
});
