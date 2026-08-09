/**
 * 外部連携・保存・車両割当まわりのテスト（実際のGoogle APIは呼ばない）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DummyProvider, GoogleRoutesProvider, createTravelProvider,
  geocodeAddress, pickRoutingPreference, resolveDepartureTime,
} from '../travelProvider';
import { assignMembersToVehicles, checkVehicleFit, departureDate } from '../planner';
import { classifyGeocodeStatus, classifyThrown, makeError } from '../apiErrors';
import { decodePolyline } from '../googleRoutes';
import { toHHMM, toMin } from '../time';
import { clearTenantKey, getTenantKey, isKeyPersisted, looksLikeApiKey, maskKey, setTenantKey } from '../keyVault';
import { LocalTenantRepository } from '../repository';
import { sampleFacility, sampleMembers, sampleVehicles } from '../../data/sampleData';
import { member, vehicle, FACILITY } from './helpers';

describe('10 移動時間プロバイダ', () => {
  it('デモモードでは通常時と予測が同値になる', async () => {
    const pts = [FACILITY, { lat: 34.83, lng: 134.67 }, FACILITY];
    const m = await new DummyProvider().getMatrix(pts);
    expect(m.source).toBe('dummy');
    expect(m.routingPreference).toBe('DUMMY');
    expect(m.minutes).toEqual(m.staticMinutes);
    expect(m.minutes[0][1]).toBeGreaterThan(0);
    expect(m.minutes[0][0]).toBe(0);
  });

  it('APIキーが無ければ推定プロバイダが選ばれる（オフラインでも動く）', async () => {
    const p = createTravelProvider();
    const m = await p.getMatrix([FACILITY, { lat: 34.83, lng: 134.67 }, FACILITY]);
    expect(m.source).toBe('dummy');
  });

  it('人数が多すぎる場合はAPIを呼ばずにTOO_MANYで止まる', async () => {
    const provider = new GoogleRoutesProvider('dummy-key-not-used');
    const pts = Array.from({ length: 30 }, () => FACILITY); // 30^2 = 900 > 625
    await expect(provider.getMatrix(pts)).rejects.toMatchObject({ code: 'TOO_MANY' });
  });

  it('出発時刻が過去なら翌日の同時刻に繰り上げる', () => {
    const past = new Date(); past.setHours(past.getHours() - 3);
    const future = new Date(); future.setHours(future.getHours() + 3);
    expect(resolveDepartureTime(past).shiftedToNextDay).toBe(true);
    expect(resolveDepartureTime(future).shiftedToNextDay).toBe(false);
    expect(resolveDepartureTime(past).date.getTime()).toBeGreaterThan(Date.now());
  });

  it('地点数でルーティング設定が切り替わる', () => {
    expect(pickRoutingPreference(7)).toBe('TRAFFIC_AWARE_OPTIMAL');
    expect(pickRoutingPreference(10)).toBe('TRAFFIC_AWARE_OPTIMAL');
    expect(pickRoutingPreference(11)).toBe('TRAFFIC_AWARE');
  });

  it('交通状況を使わない設定ではTRAFFIC_UNAWAREになる（費用の安いSKU）', () => {
    expect(pickRoutingPreference(7, false)).toBe('TRAFFIC_UNAWARE');
    expect(pickRoutingPreference(30, false)).toBe('TRAFFIC_UNAWARE');
    expect(pickRoutingPreference(7, true)).toBe('TRAFFIC_AWARE_OPTIMAL');
  });

  it('departureDate は当日の指定時刻を返す', () => {
    const d = departureDate('08:15', new Date('2026-08-09T00:00:00'));
    expect(d.getHours()).toBe(8);
    expect(d.getMinutes()).toBe(15);
  });
});

describe('11 住所検索とエラー分類', () => {
  it('APIキーが無い状態ではNO_KEYで失敗する（住所は送信されない）', async () => {
    await expect(geocodeAddress('架空県架空市1-1')).rejects.toMatchObject({ code: 'NO_KEY' });
  });

  it('Geocodingのstatusを日本語エラーに変換する', () => {
    expect(classifyGeocodeStatus('ZERO_RESULTS').code).toBe('NOT_FOUND');
    expect(classifyGeocodeStatus('OVER_QUERY_LIMIT').code).toBe('QUOTA');
    expect(classifyGeocodeStatus('REQUEST_DENIED', 'The provided API key is invalid').code).toBe('INVALID_KEY');
    expect(classifyGeocodeStatus('REQUEST_DENIED', 'This API project is not authorized').code).toBe('INVALID_KEY');
  });

  it('ネットワーク断はNETWORKとして扱う', () => {
    expect(classifyThrown(new TypeError('Failed to fetch')).code).toBe('NETWORK');
    expect(classifyThrown(new Error('something else')).code).toBe('UNKNOWN');
  });

  it('すべてのエラーに日本語メッセージと対処法がある', () => {
    (['NO_KEY', 'INVALID_KEY', 'API_NOT_ENABLED', 'REFERER_BLOCKED', 'QUOTA',
      'NOT_FOUND', 'NO_ROUTE', 'TOO_MANY', 'NETWORK', 'UNKNOWN'] as const).forEach((c) => {
      const e = makeError(c);
      expect(e.message.length).toBeGreaterThan(0);
      expect(e.hint.length).toBeGreaterThan(0);
    });
  });
});

describe('12 ポリラインと時刻変換', () => {
  it('Google公式サンプルのポリラインを復号できる', () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(pts).toHaveLength(3);
    expect(pts[0].lat).toBeCloseTo(38.5, 5);
    expect(pts[2].lng).toBeCloseTo(-126.453, 5);
  });

  it('時刻文字列と分の相互変換', () => {
    expect(toMin('08:05')).toBe(485);
    expect(toHHMM(485)).toBe('08:05');
    expect(toHHMM(0)).toBe('00:00');
    expect(toMin('bad')).toBe(0);
  });
});

describe('13 車両への割り当て', () => {
  it('稼働車両が1台なら全員をその車両へ', () => {
    const ms = [member({ name: 'A' }), member({ name: 'B' })];
    const groups = assignMembersToVehicles(ms, [vehicle({ id: 'car-a', name: '車両A' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(2);
  });

  it('定員超過は事前に警告される', () => {
    const ms = Array.from({ length: 9 }, (_, i) => member({ name: `利用者${i}` }));
    const issues = checkVehicleFit(ms, vehicle({ id: 'car-a', name: '車両A', capacity: 8 }));
    expect(issues.map((i) => i.code)).toContain('CAPACITY');
  });

  it('車いす非対応車両に車いす利用者がいると警告される', () => {
    const ms = [member({ name: '車いす', requiresWheelchair: true })];
    const issues = checkVehicleFit(ms, vehicle({ id: 'car-b', name: '車両B', wheelchair: false }));
    expect(issues.map((i) => i.code)).toContain('WHEELCHAIR');
  });

  it('複数車両では車いす利用者が対応車両に配車される', () => {
    const ms = [
      member({ name: '車いす1', requiresWheelchair: true }),
      member({ name: '一般1' }), member({ name: '一般2' }), member({ name: '一般3' }),
    ];
    const groups = assignMembersToVehicles(ms, [
      vehicle({ id: 'car-a', name: '車両A', capacity: 4, wheelchair: true }),
      vehicle({ id: 'car-b', name: '車両B', capacity: 4, wheelchair: false }),
    ]);
    const wcGroup = groups.find((g) => g.members.some((m) => m.requiresWheelchair))!;
    expect(wcGroup.vehicle.wheelchair).toBe(true);
    expect(groups.reduce((a, g) => a + g.members.length, 0)).toBe(4);
  });

  it('適合していれば警告は出ない', () => {
    expect(checkVehicleFit([member({ name: 'A' })], vehicle({ id: 'car-a', name: '車両A' }))).toHaveLength(0);
  });
});

describe('14 APIキーの保管', () => {
  beforeEach(() => { clearTenantKey('t1'); });

  it('既定のセッション保存では端末に残らない', () => {
    setTenantKey('t1', 'AIzaSyTESTKEYTESTKEYTESTKEYTESTKEY123', 'session');
    expect(getTenantKey('t1')).toContain('AIzaSy');
    expect(isKeyPersisted('t1')).toBe(false);
  });

  it('明示的に選んだ場合のみ端末に保存される', () => {
    setTenantKey('t1', 'AIzaSyTESTKEYTESTKEYTESTKEYTESTKEY123', 'local');
    expect(isKeyPersisted('t1')).toBe(true);
    clearTenantKey('t1');
    expect(getTenantKey('t1')).toBe('');
    expect(isKeyPersisted('t1')).toBe(false);
  });

  it('保存方式を切り替えると古い保存先に残らない', () => {
    setTenantKey('t1', 'AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1', 'local');
    setTenantKey('t1', 'AIzaSyBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2', 'session');
    expect(isKeyPersisted('t1')).toBe(false);
    expect(getTenantKey('t1')).toContain('BBBB');
  });

  it('キーの形式判定と画面表示用マスク', () => {
    expect(looksLikeApiKey('AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1')).toBe(true);
    expect(looksLikeApiKey('not-a-key')).toBe(false);
    const masked = maskKey('AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1');
    expect(masked.startsWith('AIzaSy')).toBe(true);
    expect(masked).toContain('*');
    expect(masked).not.toContain('AAAAAAAAAA');
  });
});

describe('15 保存層（Repository）', () => {
  const repo = new LocalTenantRepository();
  const data = {
    facility: sampleFacility, members: sampleMembers, vehicles: sampleVehicles,
    selectedIds: sampleMembers.map((m) => m.id), departTime: '08:00', vehicleId: 'car-a',
    dayPlan: null, activeRouteIndex: 0, manualOrder: null, history: [],
  };

  it('保存・読み出し・削除ができる', async () => {
    await repo.save('tenant-x', data);
    const loaded = await repo.load('tenant-x');
    expect(loaded?.members).toHaveLength(sampleMembers.length);
    await repo.clear('tenant-x');
    expect(await repo.load('tenant-x')).toBeNull();
  });

  it('テナントごとにデータが分離される', async () => {
    await repo.save('tenant-a', data);
    await repo.save('tenant-b', { ...data, members: [] });
    expect((await repo.load('tenant-a'))!.members.length).toBeGreaterThan(0);
    expect((await repo.load('tenant-b'))!.members).toHaveLength(0);
    await repo.clear('tenant-a'); await repo.clear('tenant-b');
  });

  it('バックアップの書き出しと取り込みができる', async () => {
    await repo.save('tenant-x', data);
    const json = await repo.exportJson('tenant-x');
    await repo.clear('tenant-x');
    const restored = await repo.importJson('tenant-x', json);
    expect(restored.members).toHaveLength(sampleMembers.length);
    expect((await repo.load('tenant-x'))!.facility.name).toBe(sampleFacility.name);
    await repo.clear('tenant-x');
  });

  it('壊れたファイルの取り込みは分かりやすく失敗する', async () => {
    await expect(repo.importJson('tenant-x', '{"foo":1}')).rejects.toThrow(/施設情報が見つかりません/);
  });
});
