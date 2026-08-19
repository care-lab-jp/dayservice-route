/**
 * モニタリング記録を「期間ごとの履歴」として扱えることのテスト。
 * 過去の記録が、あとからの操作で書き換わらないことを重点的に確認する。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  copyForNewRecord, findOverlapping, historySummary, overlapWarningMessage,
  sortByPeriodDesc, validatePeriod,
} from '../monitoringRules';
import { buildMonitoringSheet, requestMonitoringExcelExport } from '../monitoringExcel';
import { displayMonitoringText } from '../monitoringText';
import { newMonitoringId, useAppStore } from '../../store/useAppStore';
import { sampleMembers } from '../../data/sampleData';
import type { MonitoringRecord } from '../../types';

const rec = (over: Partial<MonitoringRecord> = {}): MonitoringRecord => ({
  monitoringRecordId: over.monitoringRecordId ?? newMonitoringId(),
  memberId: 'm-1',
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
  periodFrom: '2026-07-01',
  periodTo: '2026-08-31',
  longTermGoal: '住み慣れた自宅で安全に生活を継続する',
  shortTermGoal: '屋内での歩行を安定させる',
  checkedItems: [],
  generatedText: '本文',
  ...over,
});

beforeEach(() => {
  useAppStore.setState({ monitoringRecords: [], supportRecords: [] });
});

describe('H-01/02 複数期間の履歴', () => {
  it('1利用者に複数のモニタリング記録を保存できる', () => {
    const s = useAppStore.getState();
    s.addMonitoringRecord(rec({ periodFrom: '2026-03-01', periodTo: '2026-04-30' }));
    s.addMonitoringRecord(rec({ periodFrom: '2026-05-01', periodTo: '2026-06-30' }));
    s.addMonitoringRecord(rec({ periodFrom: '2026-07-01', periodTo: '2026-08-31' }));
    expect(useAppStore.getState().monitoringRecordsOf('m-1')).toHaveLength(3);
  });

  it('期間の新しい順に並ぶ', () => {
    const list = sortByPeriodDesc([
      rec({ periodFrom: '2026-03-01', periodTo: '2026-04-30' }),
      rec({ periodFrom: '2026-07-01', periodTo: '2026-08-31' }),
      rec({ periodFrom: '2026-05-01', periodTo: '2026-06-30' }),
    ]);
    expect(list.map((r) => r.periodTo)).toEqual(['2026-08-31', '2026-06-30', '2026-04-30']);
  });

  it('期間が未入力の記録が混ざっても並べ替えで落ちない', () => {
    const list = sortByPeriodDesc([
      rec({ periodFrom: '', periodTo: '', createdAt: '2026-01-01T00:00:00.000Z' }),
      rec({ periodFrom: '2026-07-01', periodTo: '2026-08-31' }),
    ]);
    expect(list).toHaveLength(2);
    expect(list[0].periodTo).toBe('2026-08-31');
  });

  it('履歴の見出し情報（期間・評価・更新日）を作れる', () => {
    const sum = historySummary(rec({
      longTermEvaluation: '概ね達成', shortTermEvaluation: '一部達成',
      updatedAt: '2026-08-31T09:00:00.000Z',
    }));
    expect(sum.period).toBe('2026年7月1日 〜 2026年8月31日');
    expect(sum.evaluation).toBe('長期：概ね達成／短期：一部達成');
    expect(sum.updatedAt).toBe('2026/08/31');
    expect(historySummary(rec()).evaluation).toBe('評価未入力');
  });
});

describe('H-03/04/05 編集と新規作成の独立性', () => {
  it('過去の記録を開いて編集でき、他の記録は変わらない', () => {
    const s = useAppStore.getState();
    const older = rec({ monitoringRecordId: 'old', periodFrom: '2026-05-01', periodTo: '2026-06-30' });
    const newer = rec({ monitoringRecordId: 'new', periodFrom: '2026-07-01', periodTo: '2026-08-31' });
    s.addMonitoringRecord(older);
    s.addMonitoringRecord(newer);

    useAppStore.getState().updateMonitoringRecord('old', {
      shortTermGoal: '書き換えた短期目標', shortTermEvaluation: '達成',
    });

    const list = useAppStore.getState().monitoringRecordsOf('m-1');
    const o = list.find((r) => r.monitoringRecordId === 'old')!;
    const n = list.find((r) => r.monitoringRecordId === 'new')!;
    expect(o.shortTermGoal).toBe('書き換えた短期目標');
    expect(o.shortTermEvaluation).toBe('達成');
    // もう一方は一切変わっていない
    expect(n.shortTermGoal).toBe('屋内での歩行を安定させる');
    expect(n.shortTermEvaluation).toBeUndefined();
    expect(n.updatedAt).toBe(newer.updatedAt);
  });

  it('新しい記録を作っても既存の記録は上書きされない', () => {
    const s = useAppStore.getState();
    s.addMonitoringRecord(rec({ monitoringRecordId: 'first', periodTo: '2026-06-30' }));
    s.addMonitoringRecord(rec({ monitoringRecordId: 'second', periodTo: '2026-08-31' }));
    const list = useAppStore.getState().monitoringRecordsOf('m-1');
    expect(list).toHaveLength(2);
    expect(new Set(list.map((r) => r.monitoringRecordId)).size).toBe(2);
  });

  it('削除しても他の期間の記録は残る', () => {
    const s = useAppStore.getState();
    s.addMonitoringRecord(rec({ monitoringRecordId: 'a' }));
    s.addMonitoringRecord(rec({ monitoringRecordId: 'b', periodTo: '2026-06-30' }));
    useAppStore.getState().removeMonitoringRecord('a');
    const list = useAppStore.getState().monitoringRecordsOf('m-1');
    expect(list).toHaveLength(1);
    expect(list[0].monitoringRecordId).toBe('b');
  });
});

describe('H-06/07 前回記録のコピー', () => {
  it('目標・評価・反映内容を複製し、IDと期間は引き継がない', () => {
    const prev = rec({
      monitoringRecordId: 'prev',
      longTermEvaluation: '概ね達成', shortTermComment: '前回のコメント',
      checkedItems: ['walk-distance'], baseline: { walkDistanceM: 10 },
      current: { walkDistanceM: 30 }, policy: '前回の方針', overallComment: '前回の総合',
    });
    const copy = copyForNewRecord(prev, 'm-1');

    expect(copy.monitoringRecordId).toBe('');
    expect(copy.periodFrom).toBe('');
    expect(copy.periodTo).toBe('');
    expect(copy.generatedText).toBe('');
    expect(copy.longTermGoal).toBe(prev.longTermGoal);
    expect(copy.longTermEvaluation).toBe('概ね達成');
    expect(copy.shortTermComment).toBe('前回のコメント');
    expect(copy.checkedItems).toEqual(['walk-distance']);
    expect(copy.policy).toBe('前回の方針');
    expect(copy.overallComment).toBe('前回の総合');
  });

  it('コピー後に編集しても元の記録は変わらない（参照を共有しない）', () => {
    const prev = rec({
      monitoringRecordId: 'prev',
      checkedItems: ['walk-distance'],
      baseline: { walkDistanceM: 10 }, current: { walkDistanceM: 30 },
    });
    const copy = copyForNewRecord(prev, 'm-1');

    copy.longTermGoal = '新しい目標';
    copy.checkedItems.push('stand-up');
    copy.baseline!.walkDistanceM = 999;
    copy.current!.walkDistanceM = 999;

    expect(prev.longTermGoal).toBe('住み慣れた自宅で安全に生活を継続する');
    expect(prev.checkedItems).toEqual(['walk-distance']);
    expect(prev.baseline!.walkDistanceM).toBe(10);
    expect(prev.current!.walkDistanceM).toBe(30);
  });

  it('コピー元を保存済みのまま、新規として保存できる', () => {
    const prev = rec({ monitoringRecordId: 'prev' });
    useAppStore.getState().addMonitoringRecord(prev);

    const copy = copyForNewRecord(prev, 'm-1');
    useAppStore.getState().addMonitoringRecord({
      ...copy,
      monitoringRecordId: newMonitoringId(),
      periodFrom: '2026-09-01', periodTo: '2026-10-31',
      createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z',
      generatedText: '新しい本文',
    });

    const list = useAppStore.getState().monitoringRecordsOf('m-1');
    expect(list).toHaveLength(2);
    expect(list[0].periodTo).toBe('2026-10-31');
    expect(list.find((r) => r.monitoringRecordId === 'prev')!.periodTo).toBe('2026-08-31');
  });
});

describe('H-08/09/10 期間のチェック', () => {
  it('開始日が終了日より後なら保存できない', () => {
    const v = validatePeriod('2026-09-01', '2026-08-31');
    expect(v.ok).toBe(false);
    expect(v.error).toContain('開始日が終了日より後');
  });

  it('片方だけ・両方未入力でも保存できない', () => {
    expect(validatePeriod('', '').ok).toBe(false);
    expect(validatePeriod('2026-07-01', '').ok).toBe(false);
    expect(validatePeriod('', '2026-08-31').ok).toBe(false);
  });

  it('開始日と終了日が同じ日は有効', () => {
    expect(validatePeriod('2026-07-01', '2026-07-01').ok).toBe(true);
  });

  it('期間が重なる記録を検出する', () => {
    const list = [
      rec({ monitoringRecordId: 'a', periodFrom: '2026-07-01', periodTo: '2026-08-31' }),
      rec({ monitoringRecordId: 'b', periodFrom: '2026-05-01', periodTo: '2026-06-30' }),
    ];
    // 一部重なる
    expect(findOverlapping(list, 'm-1', '2026-08-01', '2026-09-30').map((r) => r.monitoringRecordId))
      .toEqual(['a']);
    // 完全に同じ
    expect(findOverlapping(list, 'm-1', '2026-07-01', '2026-08-31')).toHaveLength(1);
    // 重ならない
    expect(findOverlapping(list, 'm-1', '2026-09-01', '2026-10-31')).toHaveLength(0);
  });

  it('編集中の記録自身は重複とみなさない', () => {
    const list = [rec({ monitoringRecordId: 'a', periodFrom: '2026-07-01', periodTo: '2026-08-31' })];
    expect(findOverlapping(list, 'm-1', '2026-07-01', '2026-08-31', 'a')).toHaveLength(0);
  });

  it('別の利用者の記録は重複判定に含めない', () => {
    const list = [rec({ monitoringRecordId: 'a', memberId: 'm-2' })];
    expect(findOverlapping(list, 'm-1', '2026-07-01', '2026-08-31')).toHaveLength(0);
  });

  it('警告文に重なっている期間が示され、保存禁止ではない', () => {
    const msg = overlapWarningMessage([rec()]);
    expect(msg).toContain('重なるモニタリング記録があります');
    expect(msg).toContain('2026年7月1日 〜 2026年8月31日');
    expect(msg).toContain('このまま保存しますか？');
  });

  it('警告のあと保存すれば、同じ期間の記録も残せる', () => {
    const s = useAppStore.getState();
    s.addMonitoringRecord(rec({ monitoringRecordId: 'a' }));
    // 職員が「保存する」を選んだ場合を想定
    s.addMonitoringRecord(rec({ monitoringRecordId: 'b' }));
    expect(useAppStore.getState().monitoringRecordsOf('m-1')).toHaveLength(2);
  });
});

describe('H-11 履歴からの個別Excel出力', () => {
  it('各期間の記録をそれぞれ出力できる（既存の処理を再利用）', async () => {
    const a = rec({ periodFrom: '2026-05-01', periodTo: '2026-06-30' });
    const b = rec({ periodFrom: '2026-07-01', periodTo: '2026-08-31' });

    expect(buildMonitoringSheet(a, '田中').fileName).toBe('monitoring_田中_2026-06-30.xlsx');
    expect(buildMonitoringSheet(b, '田中').fileName).toBe('monitoring_田中_2026-08-31.xlsx');

    const exporter = vi.fn().mockResolvedValue('ok.xlsx');
    await requestMonitoringExcelExport(a, '田中', () => true, exporter);
    await requestMonitoringExcelExport(b, '田中', () => true, exporter);
    expect(exporter).toHaveBeenCalledTimes(2);
    expect(exporter.mock.calls[0][0].periodTo).toBe('2026-06-30');
    expect(exporter.mock.calls[1][0].periodTo).toBe('2026-08-31');
  });
});

describe('H-12 既存データの互換性', () => {
  it('v0.5.1で保存された記録がそのまま履歴に表示できる', () => {
    // v0.5.1時点のフィールドだけを持つ記録
    const old: MonitoringRecord = {
      monitoringRecordId: 'v051', memberId: 'm-1',
      createdAt: '2026-06-30T00:00:00.000Z', updatedAt: '2026-06-30T00:00:00.000Z',
      periodFrom: '2026-05-01', periodTo: '2026-06-30',
      longTermGoal: '自宅生活の継続', shortTermGoal: '屋内歩行の安定',
      checkedItems: ['walk-distance'], generatedText: '以前に作成した本文',
    };
    useAppStore.getState().addMonitoringRecord(old);

    const list = useAppStore.getState().monitoringRecordsOf('m-1');
    expect(list).toHaveLength(1);
    expect(displayMonitoringText(list[0])).toBe('以前に作成した本文');
    expect(historySummary(list[0]).period).toBe('2026年5月1日 〜 2026年6月30日');
    expect(buildMonitoringSheet(list[0], '田中').rows.length).toBeGreaterThan(0);
  });
});

describe('H-13/14 送迎機能への非干渉', () => {
  it('履歴を増やしても memberFingerprint は変わらない', async () => {
    const { memberFingerprint } = await import('../freshness');
    const m = sampleMembers[0];
    const before = memberFingerprint(m);

    const s = useAppStore.getState();
    s.addMonitoringRecord(rec({ memberId: m.id, monitoringRecordId: '1' }));
    s.addMonitoringRecord(rec({ memberId: m.id, monitoringRecordId: '2', periodTo: '2026-06-30' }));
    useAppStore.getState().updateMonitoringRecord('1', { overallComment: '編集した' });
    useAppStore.getState().removeMonitoringRecord('2');

    expect(memberFingerprint(sampleMembers[0])).toBe(before);
  });

  it('モニタリング操作で送迎表の鮮度判定が変わらない', async () => {
    const { planFreshness, buildSnapshot, todayKey } = await import('../freshness');
    const { sampleFacility, sampleVehicles } = await import('../../data/sampleData');
    const ctx = {
      facility: sampleFacility, members: sampleMembers,
      vehicles: sampleVehicles, departTime: '08:00',
    };
    const dayPlan = {
      tenantId: 't', facilityId: 'f', date: todayKey(), departTime: '08:00',
      snapshot: buildSnapshot(sampleFacility, sampleMembers, sampleVehicles, '08:00'),
      routes: [{
        vehicleId: 'car-a', departMin: 480,
        stops: [{
          memberId: sampleMembers[0].id, anonId: '利用者A', order: 1,
          arriveMin: 490, departMin: 495, travelMin: 10, waitMin: 0, lateMin: 0,
        }],
        returnMin: 540, lastLegMin: 10, totalTravelMin: 20, issues: [],
        travelSource: 'dummy' as const, createdAt: new Date().toISOString(),
      }],
      createdAt: new Date().toISOString(),
    };

    expect(planFreshness(dayPlan, ctx).status).toBe('READY');
    useAppStore.getState().addMonitoringRecord(rec({ memberId: sampleMembers[0].id }));
    expect(planFreshness(dayPlan, ctx).status).toBe('READY');
  });
});
