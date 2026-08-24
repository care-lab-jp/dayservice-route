/**
 * モニタリング記録のテスト。
 * 最重要は「入力されていない事実を作らない」「外部通信をしない」こと。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMonitoringText, displayMonitoringText, formatDateJa, periodLabel } from '../monitoringText';
import {
  buildMonitoringSheet, EXPORT_CONFIRM_MESSAGE, requestMonitoringExcelExport,
} from '../monitoringExcel';
import { LocalTenantRepository, SCHEMA_VERSION } from '../repository';
import { useAppStore, newMonitoringId } from '../../store/useAppStore';
import { sampleFacility, sampleMembers, sampleVehicles } from '../../data/sampleData';
import type { MonitoringRecord } from '../../types';

const base = (over: Partial<MonitoringRecord> = {}): MonitoringRecord => ({
  monitoringRecordId: 'mon-1',
  memberId: 'm-1',
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
  periodFrom: '2026-07-01',
  periodTo: '2026-08-31',
  longTermGoal: '住み慣れた自宅で安全に生活を継続する',
  shortTermGoal: '屋内での歩行を安定させ、トイレまで安全に移動できる',
  checkedItems: [],
  generatedText: '',
  ...over,
});

describe('M-01 期間', () => {
  it('入力した期間がそのまま文章になる', () => {
    const t = buildMonitoringText(base()).text;
    expect(t).toContain('モニタリング期間：2026年7月1日から2026年8月31日まで');
  });

  it('期間未入力なら期間の行を出さない', () => {
    const t = buildMonitoringText(base({ periodFrom: '', periodTo: '' })).text;
    expect(t).not.toContain('モニタリング期間');
  });

  it('日数・月数を勝手に計算しない', () => {
    const t = buildMonitoringText(base()).text;
    ['か月', 'ヶ月', '週間', '日間', '2か月'].forEach((w) => expect(t).not.toContain(w));
  });

  it('期間の表示と日付整形', () => {
    expect(formatDateJa('2026-07-01')).toBe('2026年7月1日');
    expect(formatDateJa('')).toBe('');
    expect(periodLabel({ periodFrom: '', periodTo: '' })).toBe('期間未入力');
  });
});

describe('M-02/03 目標', () => {
  it('長期目標・短期目標が保存され文章に出る', () => {
    const t = buildMonitoringText(base()).text;
    expect(t).toContain('長期目標：住み慣れた自宅で安全に生活を継続する');
    expect(t).toContain('短期目標：屋内での歩行を安定させ、トイレまで安全に移動できる');
  });

  it('目標が未入力なら勝手に作らない', () => {
    const t = buildMonitoringText(base({ longTermGoal: '', shortTermGoal: '' })).text;
    expect(t).not.toContain('長期目標');
    expect(t).not.toContain('短期目標');
  });
});

describe('M-04/07 目標の評価', () => {
  it('選んだ評価とコメントが文章になる', () => {
    const t = buildMonitoringText(base({
      longTermEvaluation: '概ね達成', longTermComment: '外出の機会が増えている',
      shortTermEvaluation: '一部達成',
    })).text;
    expect(t).toContain('長期目標に対する評価：概ね達成');
    expect(t).toContain('外出の機会が増えている');
    expect(t).toContain('短期目標に対する評価：一部達成');
  });

  it('評価が未選択なら評価の行を出さない', () => {
    const t = buildMonitoringText(base()).text;
    expect(t).not.toContain('評価：');
  });

  it('「評価困難」を達成扱いしない', () => {
    const t = buildMonitoringText(base({
      longTermEvaluation: '評価困難', shortTermEvaluation: '評価困難',
    })).text;
    expect(t).toContain('評価：評価困難');
    expect(t).not.toMatch(/達成し|改善|向上/);
    expect(t).toContain('今後も、状況を確認しながら支援を継続します。');
  });

  it('未達成でも改善表現を出さない', () => {
    const t = buildMonitoringText(base({ shortTermEvaluation: '未達成' })).text;
    expect(t).not.toMatch(/改善|向上/);
  });
});

describe('M-05 支援記録からの反映', () => {
  it('反映したチェック項目が現在の状態・支援内容・意向になる', () => {
    const t = buildMonitoringText(base({
      checkedItems: ['walk-distance', 'sup-gait', 'wish-toilet'],
    })).text;
    expect(t).toContain('歩行距離の延長がみられています。');
    expect(t).toContain('歩行訓練に取り組んでいます。');
    expect(t).toContain('本人は、自分でトイレまで行くことを希望しています。');
  });

  it('数値は開始時と現在の両方があるときだけ出る', () => {
    const both = buildMonitoringText(base({
      checkedItems: ['walk-distance'],
      baseline: { walkDistanceM: 10 }, current: { walkDistanceM: 30 },
    })).text;
    expect(both).toContain('歩行距離は10mから30mに延長しています。');

    const one = buildMonitoringText(base({
      checkedItems: ['walk-distance'], baseline: { walkDistanceM: 10 },
    })).text;
    expect(one).not.toMatch(/[0-9]+m/);
  });
});

describe('M-06 入力されていない事実を作らない', () => {
  it('禁止表現が出力に含まれない', () => {
    const t = buildMonitoringText(base({
      checkedItems: ['walk-distance', 'stand-up', 'sup-lower', 'wish-walk'],
      longTermEvaluation: '達成', shortTermEvaluation: '達成',
    })).text;
    [
      'か月', '週間', '半年', '大幅', '著しく', 'かなり',
      '満足', '問題なく', '安心して過ごせている', '自立した', '完治',
      'と思われ', '推測', 'AI',
    ].forEach((w) => expect(t).not.toContain(w));
  });

  it('本人の意向は入力がある場合のみ出る', () => {
    const t = buildMonitoringText(base({ checkedItems: ['sup-lower'] })).text;
    expect(t).not.toContain('本人は');
  });

  it('職員が方針を書けばそれをそのまま使う', () => {
    const t = buildMonitoringText(base({ policy: '訪問リハビリとの連携を検討する。' })).text;
    expect(t).toContain('訪問リハビリとの連携を検討する。');
  });

  it('状態低下があれば慎重な方針にする', () => {
    const t = buildMonitoringText(base({
      checkedItems: ['decline'], shortTermEvaluation: '達成',
    })).text;
    expect(t).toContain('状態の変化に留意しながら');
    expect(t).not.toMatch(/向上を目指し/);
  });
});

describe('M-08 履歴の保存', () => {
  beforeEach(() => {
    useAppStore.setState({ monitoringRecords: [], supportRecords: [] });
  });

  it('1利用者に複数のモニタリング記録を保存できる', () => {
    const s = useAppStore.getState();
    s.addMonitoringRecord(base({ monitoringRecordId: newMonitoringId(), periodTo: '2026-06-30' }));
    s.addMonitoringRecord(base({ monitoringRecordId: newMonitoringId(), periodTo: '2026-08-31' }));
    const list = useAppStore.getState().monitoringRecordsOf('m-1');
    expect(list).toHaveLength(2);
    // 新しい期間が先頭
    expect(list[0].periodTo).toBe('2026-08-31');
  });

  it('更新と削除ができる', () => {
    const id = newMonitoringId();
    useAppStore.getState().addMonitoringRecord(base({ monitoringRecordId: id }));
    useAppStore.getState().updateMonitoringRecord(id, { longTermGoal: '変更後の目標' });
    expect(useAppStore.getState().monitoringRecordsOf('m-1')[0].longTermGoal).toBe('変更後の目標');
    useAppStore.getState().removeMonitoringRecord(id);
    expect(useAppStore.getState().monitoringRecordsOf('m-1')).toHaveLength(0);
  });

  it('他の利用者の記録は混ざらない', () => {
    useAppStore.getState().addMonitoringRecord(base({ monitoringRecordId: 'a', memberId: 'm-1' }));
    useAppStore.getState().addMonitoringRecord(base({ monitoringRecordId: 'b', memberId: 'm-2' }));
    expect(useAppStore.getState().monitoringRecordsOf('m-1')).toHaveLength(1);
    expect(useAppStore.getState().monitoringRecordsOf('m-2')).toHaveLength(1);
  });
});

describe('M-09 外部通信が発生しない', () => {
  it('文章づくりとシート組み立ての間に通信APIが呼ばれない', () => {
    const fetchSpy = vi.fn();
    const beaconSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('navigator', { sendBeacon: beaconSpy });

    const r = base({ checkedItems: ['walk-distance'], overallComment: '家族と情報共有した' });
    buildMonitoringText(r);
    buildMonitoringSheet(r, '田中');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('モジュールに外部通信の記述がない', async () => {
    const mt = await import('../monitoringText');
    const code = Object.values(mt).map((v) => String(v)).join('\n');
    ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'openai', 'googleapis'].forEach((w) => {
      expect(code).not.toContain(w);
    });
  });
});

describe('M-10 Excel出力の中身', () => {
  const r = base({
    checkedItems: ['walk-distance', 'sup-gait', 'wish-toilet'],
    longTermEvaluation: '概ね達成', shortTermEvaluation: '一部達成',
    overallComment: 'ご家族と共有済み',
  });

  it('必要な項目がすべて含まれる', () => {
    const sheet = buildMonitoringSheet(r, '田中');
    const labels = sheet.rows.map((row) => row[0]);
    [
      'モニタリング記録', '利用者氏名', 'モニタリング期間',
      '【長期目標】', '【長期目標の評価】', '【短期目標】', '【短期目標の評価】',
      '【現在の状態】', '【支援内容】', '【本人の意向】',
      '【今後の支援方針】', '【モニタリング総合コメント】',
    ].forEach((l) => expect(labels).toContain(l));
  });

  it('項目名と内容が別の列に分かれている', () => {
    const sheet = buildMonitoringSheet(r, '田中');
    const nameRow = sheet.rows.find((row) => row[0] === '利用者氏名')!;
    expect(nameRow[1]).toBe('田中');
    expect(sheet.colWidths).toHaveLength(2);
  });

  it('ファイル名に施設名を含めず、利用者名と日付を含む', () => {
    const sheet = buildMonitoringSheet(r, '田中');
    expect(sheet.fileName).toBe('monitoring_田中_2026-08-31.xlsx');
    expect(sheet.fileName).not.toContain('さくら');
    expect(sheet.fileName).not.toContain('デイサービス');
  });

  it('ファイル名に使えない文字を除去する', () => {
    const sheet = buildMonitoringSheet(r, '田中/太郎 *?');
    expect(sheet.fileName).not.toMatch(/[\\/:*?"<>|\s]/);
  });

  it('編集済みの文章があればそれを本文に使う', () => {
    const edited = { ...r, generatedText: 'もとの文章', editedText: '職員が直した文章' };
    const sheet = buildMonitoringSheet(edited, '田中');
    const body = sheet.rows.find((row) => row[0] === '【記録本文】')!;
    expect(body[1]).toBe('職員が直した文章');
    expect(displayMonitoringText(edited)).toBe('職員が直した文章');
  });
});

describe('M-11 個人情報の確認ダイアログ', () => {
  it('確認文言に個人情報を含む旨と保存先の注意が入っている', () => {
    expect(EXPORT_CONFIRM_MESSAGE).toContain('個人情報');
    expect(EXPORT_CONFIRM_MESSAGE).toContain('保存先');
  });

  it('確認しなければ出力しない', async () => {
    const confirmFn = vi.fn().mockReturnValue(false);
    const result = await requestMonitoringExcelExport(base(), '田中', confirmFn);
    expect(confirmFn).toHaveBeenCalledWith(EXPORT_CONFIRM_MESSAGE);
    expect(result).toBeNull();
  });

  it('確認したときだけ出力処理が呼ばれる', async () => {
    const exporter = vi.fn().mockResolvedValue('monitoring_田中_2026-08-31.xlsx');

    const cancelled = await requestMonitoringExcelExport(base(), '田中', () => false, exporter);
    expect(cancelled).toBeNull();
    expect(exporter).not.toHaveBeenCalled();

    const done = await requestMonitoringExcelExport(base(), '田中', () => true, exporter);
    expect(done).toBe('monitoring_田中_2026-08-31.xlsx');
    expect(exporter).toHaveBeenCalledTimes(1);
  });
});

describe('M-12 保存とマイグレーション', () => {
  const repo = new LocalTenantRepository();
  const data = {
    facility: sampleFacility, members: sampleMembers, vehicles: sampleVehicles,
    selectedIds: [], departTime: '08:00', vehicleId: 'car-a',
    dayPlan: null, activeRouteIndex: 0, manualOrder: null,
    history: [], supportRecords: [], monitoringRecords: [base()],
    monitoringGoalTerms: [], monitoringMonthly: [],
  };

  it('モニタリング記録を保存・読み出しできる', async () => {
    await repo.save('t-mon', data);
    expect((await repo.load('t-mon'))!.monitoringRecords).toHaveLength(1);
    await repo.clear('t-mon');
  });

  it('書き出しでは既定で除外し、明示したときだけ含める', async () => {
    await repo.save('t-mon', data);
    const off = JSON.parse(await repo.exportJson('t-mon'));
    expect(off.data.monitoringRecords).toHaveLength(0);
    expect(off._warning).not.toContain('要配慮情報');

    const on = JSON.parse(await repo.exportJson('t-mon', { includeSupportRecords: true }));
    expect(on.data.monitoringRecords).toHaveLength(1);
    expect(on._warning).toContain('要配慮情報');
    await repo.clear('t-mon');
  });

  it('モニタリング記録が無い古いバックアップも取り込める', async () => {
    const old = JSON.stringify({
      app: 'dayservice-route', schemaVersion: 4, tenantId: 't-old',
      data: { ...data, monitoringRecords: undefined, supportRecords: undefined },
    });
    const restored = await repo.importJson('t-old', old);
    expect(restored.monitoringRecords).toEqual([]);
    expect(restored.supportRecords).toEqual([]);
    expect(restored.members).toHaveLength(sampleMembers.length);
    await repo.clear('t-old');
  });

  it('壊れたモニタリング記録は取り込まない', async () => {
    const bad = JSON.stringify({
      app: 'dayservice-route', schemaVersion: SCHEMA_VERSION, tenantId: 't-bad',
      data: { ...data, monitoringRecords: 'これは配列ではない' },
    });
    await expect(repo.importJson('t-bad', bad)).rejects.toThrow(/モニタリング記録/);
  });
});

describe('M-13/14 送迎ルート機能への影響', () => {
  it('支援記録・モニタリング記録は Member 型に含まれない（送迎表がSTALEにならない）', async () => {
    const { memberFingerprint } = await import('../freshness');
    const m = sampleMembers[0];
    const before = memberFingerprint(m);
    // 記録を追加しても Member は変化しないため、指紋も変わらない
    useAppStore.getState().addMonitoringRecord(base({ monitoringRecordId: 'x', memberId: m.id }));
    useAppStore.getState().addSupportRecord({
      recordId: 'sx', memberId: m.id,
      createdAt: '', updatedAt: '', checkedItems: ['walk-distance'], generatedText: 'テスト',
    });
    expect(memberFingerprint(sampleMembers[0])).toBe(before);
    useAppStore.setState({ monitoringRecords: [], supportRecords: [] });
  });

  it('ルート計算の入力にモニタリング記録は含まれない', async () => {
    const { buildOptimizedPlan } = await import('../routeEngine');
    const { DummyProvider } = await import('../travelProvider');
    const pts = [
      { lat: sampleFacility.lat, lng: sampleFacility.lng },
      ...sampleMembers.map((m) => ({ lat: m.lat, lng: m.lng })),
      { lat: sampleFacility.lat, lng: sampleFacility.lng },
    ];
    const matrix = await new DummyProvider().getMatrix(pts);
    const plan = buildOptimizedPlan({
      start: pts[0], end: pts[0], members: sampleMembers,
      departMin: 480, facilityArriveBy: 555, vehicleId: 'car-a',
    }, matrix);
    expect(plan.stops).toHaveLength(sampleMembers.length);
    expect(JSON.stringify(plan)).not.toContain('monitoring');
  });
});
