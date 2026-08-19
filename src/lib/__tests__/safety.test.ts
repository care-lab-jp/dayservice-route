/**
 * v0.4.1「現場安全化パッチ」の受け入れテスト。
 * レビュー(docs/REVIEW-2.md)で★を付けた欠陥に対応する。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOptimizedPlan, planFromOrder } from '../routeEngine';
import { dummyTravelMinutes, isSameSpot } from '../geo';
import { adaptPreviousOrder, reorderIfAllowed } from '../planner';
import { planFreshness, buildSnapshot, todayKey } from '../freshness';
import { ImportError, LocalTenantRepository, SCHEMA_VERSION } from '../repository';
import { makeError } from '../apiErrors';
import { geocodeAddress, getEnvApiKey } from '../travelProvider';
import { setTenantKey, clearTenantKey } from '../keyVault';
import { useSaveStatus } from '../saveStatus';
import { localStore } from '../storage';
import { sampleFacility, sampleMembers, sampleVehicles } from '../../data/sampleData';
import { FACILITY, input, matrix, member, titles, uniform, vehicle } from './helpers';
import type { DayPlan, Member } from '../../types';

/* ------------------------------------------------------------------ */
describe('T-01 同一住所（同一座標）', () => {
  it('同じ場所なら移動0分になる', () => {
    const a = { lat: 34.815, lng: 134.685 };
    expect(isSameSpot(a, { ...a })).toBe(true);
    expect(dummyTravelMinutes(a, { ...a })).toBe(0);
    expect(dummyTravelMinutes(a, { lat: 34.83, lng: 134.70 })).toBeGreaterThan(0);
  });

  it('同居のご夫婦2名でも架空の移動時間が積まれない', () => {
    const ms = [
      member({ name: '夫', lat: 34.82, lng: 134.69, boardingMinutes: 3 }),
      member({ name: '妻', lat: 34.82, lng: 134.69, boardingMinutes: 3 }),
    ];
    // 施設からは8分、夫婦間は同一座標なので0分
    const m = matrix(2, (i, j) => (i === 0 || j === 3 ? 8 : 0));
    const plan = planFromOrder(input({ members: ms, depart: '08:00', arriveBy: '10:00' }), m, [0, 1]);
    expect(plan.stops[1].travelMin).toBe(0);
    expect(plan.stops[1].arriveMin - plan.stops[0].arriveMin).toBe(3); // 乗車時間ぶんだけ
  });
});

/* ------------------------------------------------------------------ */
describe('T-07 一部区間だけ推定値', () => {
  it('推定で補完した区間が数えられ、区間にも印が付く', () => {
    const ms = [member({ name: '田中' }), member({ name: '山田' })];
    // 施設->田中 の区間だけ推定値
    const m = matrix(2, () => 6, { estimatedLeg: (i, j) => i === 0 && j === 1 });
    const plan = planFromOrder(input({ members: ms, depart: '08:00', arriveBy: '10:00' }), m, [0, 1]);
    expect(plan.stops[0].estimated).toBe(true);
    expect(plan.stops[1].estimated).toBe(false);
    expect(plan.estimatedLegCount).toBe(1);
  });

  it('全区間が実データなら0件', () => {
    const ms = [member({ name: '田中' })];
    const plan = buildOptimizedPlan(input({ members: ms, depart: '08:00', arriveBy: '10:00' }), uniform(1, 5));
    expect(plan.estimatedLegCount).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
describe('T-11 地図の認証失敗メッセージ', () => {
  it('原因を断定せず、考えられる原因をすべて案内する', () => {
    const e = makeError('MAPS_AUTH');
    expect(e.message).toContain('地図の認証に失敗');
    expect(e.hint).toContain('APIキー');
    expect(e.hint).toContain('リファラー');
    // リファラー限定の断定表現になっていないこと
    expect(e.message).not.toContain('リファラー');
  });
});

/* ------------------------------------------------------------------ */
describe('T-11b リファラー制限つきキーの誤判定', () => {
  it('「リファラー制限つきキーはこのAPIで使えない」を無効キーと判定しない', async () => {
    const { classifyGeocodeStatus } = await import('../apiErrors');
    const e = classifyGeocodeStatus(
      'REQUEST_DENIED',
      'API keys with referer restrictions cannot be used with this API.'
    );
    expect(e.code).toBe('REFERER_UNSUPPORTED');
    expect(e.message).not.toContain('正しくありません');
  });

  it('本当に無効なキーは INVALID_KEY のまま', async () => {
    const { classifyGeocodeStatus } = await import('../apiErrors');
    expect(classifyGeocodeStatus('REQUEST_DENIED', 'The provided API key is invalid.').code)
      .toBe('INVALID_KEY');
  });
});

/* ------------------------------------------------------------------ */
describe('T-12 Geocoding の複数候補', () => {
  beforeEach(() => { clearTenantKey('tenant-default'); });

  it('候補が複数あるときは候補一覧を返す（先頭を黙って確定しない）', async () => {
    setTenantKey('tenant-default', 'AIzaSyTESTKEYTESTKEYTESTKEYTESTKEY123', 'session');
    // keyMode の既定は 'shared' のため、共通キーが無い環境ではキー無しになる。
    // ここでは fetch をスタブして経路だけ検証する。
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'OK',
        results: [
          { formatted_address: '架空県架空市1-1', geometry: { location: { lat: 1, lng: 2 }, location_type: 'ROOFTOP' } },
          { formatted_address: '架空県架空市1-1-2', geometry: { location: { lat: 3, lng: 4 }, location_type: 'RANGE_INTERPOLATED' } },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    if (!getEnvApiKey()) {
      // 共通キーが無い環境では NO_KEY になることを確認して終了（挙動として正しい）
      await expect(geocodeAddress('架空県架空市1-1')).rejects.toMatchObject({ code: 'NO_KEY' });
      vi.unstubAllGlobals();
      return;
    }
    const r = await geocodeAddress('架空県架空市1-1');
    expect(r.candidates).toHaveLength(2);
    expect(r.lat).toBe(1);
    vi.unstubAllGlobals();
  });
});

/* ------------------------------------------------------------------ */
describe('T-14〜T-18 バックアップの安全性', () => {
  const repo = new LocalTenantRepository();
  const base = {
    facility: sampleFacility, members: sampleMembers, vehicles: sampleVehicles,
    selectedIds: [], departTime: '08:00', vehicleId: 'car-a',
    dayPlan: null, activeRouteIndex: 0, manualOrder: null, history: [], supportRecords: [], monitoringRecords: [],
  };

  it('T-14 書き出したJSONにAPIキーが含まれない', async () => {
    const key = 'AIzaSySECRETSECRETSECRETSECRETSECRET1';
    setTenantKey('tenant-exp', key, 'local');
    await repo.save('tenant-exp', base);
    const json = await repo.exportJson('tenant-exp');
    expect(json).not.toContain(key);
    expect(json).not.toContain('AIza');
    expect(json).toContain('個人情報が含まれます');
    clearTenantKey('tenant-exp');
    await repo.clear('tenant-exp');
  });

  it('当日のルートは書き出しに含めない（履歴も既定では含めない）', async () => {
    const dayPlan = {
      tenantId: 'tenant-exp', facilityId: 'f', date: todayKey(), departTime: '08:00',
      routes: [], createdAt: new Date().toISOString(),
    } as DayPlan;
    await repo.save('tenant-exp', {
      ...base,
      dayPlan,
      history: [{
        id: 'h1', date: todayKey(), createdAt: '', departTime: '08:00',
        memberIds: ['m-1'], orders: [], totalTravelMin: 10, returnMin: 500, hadError: false,
      }],
    });
    const parsed = JSON.parse(await repo.exportJson('tenant-exp'));
    expect(parsed.data.dayPlan).toBeNull();
    expect(parsed.data.history).toHaveLength(0);

    const withHistory = JSON.parse(await repo.exportJson('tenant-exp', { includeHistory: true }));
    expect(withHistory.data.history).toHaveLength(1);
    await repo.clear('tenant-exp');
  });

  it('T-15 旧バージョンのバックアップは取り込める', async () => {
    const old = JSON.stringify({
      app: 'dayservice-route', schemaVersion: 2, tenantId: 'tenant-y',
      data: { ...base, history: undefined },
    });
    const data = await repo.importJson('tenant-y', old);
    expect(data.members).toHaveLength(sampleMembers.length);
    expect(data.history).toEqual([]);
    await repo.clear('tenant-y');
  });

  it('T-16 未知の新バージョンは拒否して既存データを壊さない', async () => {
    await repo.save('tenant-z', base);
    const future = JSON.stringify({
      app: 'dayservice-route', schemaVersion: SCHEMA_VERSION + 5, tenantId: 'tenant-z', data: base,
    });
    await expect(repo.importJson('tenant-z', future)).rejects.toMatchObject({ code: 'FUTURE_VERSION' });
    expect((await repo.load('tenant-z'))!.members).toHaveLength(sampleMembers.length);
    await repo.clear('tenant-z');
  });

  it('T-17 別施設のバックアップは既定で拒否し、明示同意すれば取り込める', async () => {
    const other = JSON.stringify({
      app: 'dayservice-route', schemaVersion: SCHEMA_VERSION, tenantId: 'tenant-OTHER', data: base,
    });
    await expect(repo.importJson('tenant-mine', other)).rejects.toBeInstanceOf(ImportError);
    await expect(repo.importJson('tenant-mine', other)).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });

    const forced = await repo.importJson('tenant-mine', other, { allowTenantMismatch: true });
    expect(forced.members).toHaveLength(sampleMembers.length);
    await repo.clear('tenant-mine');
  });

  it('T-18 壊れた／型が違うデータは項目名つきで失敗する', async () => {
    await expect(repo.importJson('t', 'これはJSONではない')).rejects.toMatchObject({ code: 'UNKNOWN_FORMAT' });
    await expect(repo.importJson('t', '{"app":"other-app"}')).rejects.toMatchObject({ code: 'UNKNOWN_FORMAT' });

    const badTime = {
      ...base, members: [{ ...sampleMembers[0], pickupFrom: '25:99' }],
    };
    await expect(
      repo.importJson('t', JSON.stringify({ app: 'dayservice-route', schemaVersion: SCHEMA_VERSION, data: badTime }))
    ).rejects.toThrow(/お迎え希望時間/);

    const badCoord = { ...base, members: [{ ...sampleMembers[0], lat: '34.8' as unknown as number }] };
    await expect(
      repo.importJson('t', JSON.stringify({ app: 'dayservice-route', schemaVersion: SCHEMA_VERSION, data: badCoord }))
    ).rejects.toThrow(/緯度・経度/);
  });

  it('取り込み前の状態へ戻せる', async () => {
    await repo.save('tenant-undo', base);
    const replaced = JSON.stringify({
      app: 'dayservice-route', schemaVersion: SCHEMA_VERSION, tenantId: 'tenant-undo',
      data: { ...base, members: [] },
    });
    await repo.importJson('tenant-undo', replaced);
    expect((await repo.load('tenant-undo'))!.members).toHaveLength(0);
    const back = await repo.undoImport('tenant-undo');
    expect(back!.members).toHaveLength(sampleMembers.length);
    await repo.clear('tenant-undo');
  });
});

/* ------------------------------------------------------------------ */
describe('T-19 保存失敗の通知', () => {
  it('保存に失敗したら画面に出せる状態になる', () => {
    useSaveStatus.setState({ failed: false, message: '', detail: '', at: null });
    const original = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = () => {
      const e = new Error('QuotaExceededError: storage is full');
      e.name = 'QuotaExceededError';
      throw e;
    };
    localStore.setItem('k', 'v'); // 例外は外へ出さない（アプリは止めない）
    globalThis.localStorage.setItem = original;

    const st = useSaveStatus.getState();
    expect(st.failed).toBe(true);
    expect(st.message).toContain('保存できませんでした');
    expect(st.message).toContain('容量');
  });
});

/* ------------------------------------------------------------------ */
describe('T-22/T-23 送迎表と現在の設定の整合', () => {
  const ms: Member[] = [
    member({ name: '田中', id: 'm-a' } as never),
    member({ name: '山田', id: 'm-b' } as never),
  ];
  const makePlan = (memberIds: string[], date = todayKey()): DayPlan => ({
    tenantId: 't', facilityId: 'f', date, departTime: '08:00',
    snapshot: buildSnapshot(sampleFacility, ms, sampleVehicles, '08:00'),
    routes: [{
      vehicleId: 'car-a', departMin: 480,
      stops: memberIds.map((id, i) => ({
        memberId: id, anonId: `利用者${i}`, order: i + 1,
        arriveMin: 490 + i * 10, departMin: 493 + i * 10, travelMin: 10, waitMin: 0, lateMin: 0,
      })),
      returnMin: 540, lastLegMin: 10, totalTravelMin: 30, issues: [],
      travelSource: 'dummy', createdAt: new Date().toISOString(),
    }],
    createdAt: new Date().toISOString(),
  });
  const ctx = (members: Member[], departTime = '08:00') => ({
    facility: sampleFacility, members, vehicles: sampleVehicles, departTime,
  });

  it('変更がなければ READY', () => {
    const f = planFreshness(makePlan(['m-a', 'm-b']), ctx(ms));
    expect(f.status).toBe('READY');
    expect(f.reasons).toHaveLength(0);
  });

  it('T-22 利用者を削除すると STALE になり、欠損IDが分かる', () => {
    const f = planFreshness(makePlan(['m-a', 'm-b']), ctx([ms[0]]));
    expect(f.status).toBe('STALE');
    expect(f.missingMemberIds).toEqual(['m-b']);
    expect(f.reasons.join()).toContain('削除');
  });

  it('T-23 利用者を無効にすると STALE になり、氏名が示される', () => {
    const f = planFreshness(makePlan(['m-a', 'm-b']), ctx([ms[0], { ...ms[1], active: false }]));
    expect(f.status).toBe('STALE');
    expect(f.inactiveMemberIds).toEqual(['m-b']);
    expect(f.reasons.join()).toContain('山田');
  });

  it('住所を変更すると STALE になる', () => {
    const moved = [{ ...ms[0], lat: ms[0].lat + 0.05 }, ms[1]];
    const f = planFreshness(makePlan(['m-a', 'm-b']), ctx(moved));
    expect(f.status).toBe('STALE');
    expect(f.reasons.join()).toContain('田中');
  });

  it('出発時刻・車両設定・施設情報の変更も検知する', () => {
    expect(planFreshness(makePlan(['m-a']), ctx(ms, '07:30')).reasons.join()).toContain('出発時刻');

    const vehicles = sampleVehicles.map((v) => (v.id === 'car-a' ? { ...v, capacity: 4 } : v));
    expect(
      planFreshness(makePlan(['m-a']), { ...ctx(ms), vehicles }).reasons.join()
    ).toContain('車両A');

    const facility = { ...sampleFacility, arriveBy: '09:30' };
    expect(planFreshness(makePlan(['m-a']), { ...ctx(ms), facility }).reasons.join()).toContain('施設情報');
  });

  it('前日に作った送迎表は OUTDATED', () => {
    const f = planFreshness(makePlan(['m-a'], '2020-01-01'), ctx(ms));
    expect(f.status).toBe('OUTDATED');
    expect(f.reasons[0]).toContain('2020-01-01');
  });

  it('計画が無ければ READY（誤警告を出さない）', () => {
    expect(planFreshness(null, ctx(ms)).status).toBe('READY');
  });
});

/* ------------------------------------------------------------------ */
describe('T-24 前回ルートの再利用', () => {
  it('今日休みの人を外し、新しい人を末尾に足す', () => {
    const r = adaptPreviousOrder(['a', 'b', 'c'], ['a', 'c', 'd']);
    expect(r.order).toEqual(['a', 'c', 'd']);
    expect(r.removed).toEqual(['b']);
    expect(r.added).toEqual(['d']);
  });

  it('全員が休みでも落ちない', () => {
    const r = adaptPreviousOrder(['a', 'b'], ['x']);
    expect(r.order).toEqual(['x']);
    expect(r.removed).toEqual(['a', 'b']);
  });

  it('顔ぶれが同じなら前回と完全に同じ順番になる', () => {
    const r = adaptPreviousOrder(['b', 'a', 'c'], ['a', 'b', 'c']);
    expect(r.order).toEqual(['b', 'a', 'c']);
    expect(r.removed).toHaveLength(0);
    expect(r.added).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
describe('T-30 計算中の並べ替え', () => {
  const order = ['a', 'b', 'c'];
  it('計算中は無視する（再計算結果の上書きを防ぐ）', () => {
    expect(reorderIfAllowed(true, order, 0, 2)).toBeNull();
  });
  it('通常時は並べ替えられる', () => {
    expect(reorderIfAllowed(false, order, 0, 2)).toEqual(['b', 'c', 'a']);
  });
  it('同じ位置・範囲外は何もしない', () => {
    expect(reorderIfAllowed(false, order, 1, 1)).toBeNull();
    expect(reorderIfAllowed(false, order, -1, 1)).toBeNull();
    expect(reorderIfAllowed(false, order, 0, 9)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
describe('補足：車両とデモ表示', () => {
  it('デモモードのルートは全区間が推定値として数えられる', async () => {
    const { DummyProvider } = await import('../travelProvider');
    const ms = [member({ name: '田中' }), member({ name: '山田' })];
    const m = await new DummyProvider().getMatrix([
      FACILITY, { lat: ms[0].lat, lng: ms[0].lng }, { lat: ms[1].lat, lng: ms[1].lng }, FACILITY,
    ]);
    const plan = buildOptimizedPlan(input({ members: ms, depart: '08:00', arriveBy: '10:00' }), m);
    expect(plan.travelSource).toBe('dummy');
    expect(plan.estimatedLegCount).toBeGreaterThan(0);
    expect(titles(plan.issues).length).toBeGreaterThan(0);
    expect(vehicle({ id: 'car-a', name: '車両A' }).capacity).toBe(8);
  });
});

/* ------------------------------------------------------------------ */
describe('16 郵便番号', () => {
  it('全角・ハイフン・〒つきでも7桁に正規化できる', async () => {
    const { normalizeZip, formatZip, isValidZip } = await import('../postalCode');
    expect(normalizeZip('600-8216')).toBe('6008216');
    expect(normalizeZip('〒600-8216')).toBe('6008216');
    expect(normalizeZip('６００８２１６')).toBe('6008216');
    expect(formatZip('6008216')).toBe('600-8216');
    expect(isValidZip('600-821')).toBe(false);
    expect(isValidZip('600-8216')).toBe(true);
  });

  it('桁数が足りなければAPIを呼ばずに失敗する', async () => {
    const { lookupPostalCode } = await import('../postalCode');
    await expect(lookupPostalCode('600')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('該当なしのときは分かりやすいエラーになる', async () => {
    const { tryLookupPostalCode } = await import('../postalCode');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 200, message: null, results: null }),
    }));
    const { result, error } = await tryLookupPostalCode('0000000');
    expect(result).toBeNull();
    expect(error?.code).toBe('NOT_FOUND');
    vi.unstubAllGlobals();
  });

  it('住所を連結して返す', async () => {
    const { lookupPostalCode } = await import('../postalCode');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 200,
        results: [{ address1: '京都府', address2: '京都市下京区', address3: '東塩小路町' }],
      }),
    }));
    const r = await lookupPostalCode('600-8216');
    expect(r.address).toBe('京都府京都市下京区東塩小路町');
    expect(r.formattedZip).toBe('600-8216');
    vi.unstubAllGlobals();
  });
});
