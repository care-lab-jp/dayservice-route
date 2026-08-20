/**
 * 提出様式「モニタリング報告」の出力内容のテスト。
 * 紙の様式と同じ項目が並ぶこと、選んでいない項目に☑が付かないことを確認する。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ACHIEVEMENT_OPTIONS, DIRECTION_OPTIONS, IMPLEMENTATION_OPTIONS, SATISFACTION_OPTIONS,
  buildMonitoringReport, checkbox, inheritAchievement,
} from '../monitoringReport';
import { requestMonitoringExcelExport } from '../monitoringExcel';
import type { MonitoringRecord } from '../../types';

const rec = (over: Partial<MonitoringRecord> = {}): MonitoringRecord => ({
  monitoringRecordId: 'mon-1', memberId: 'm-1',
  createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z',
  periodFrom: '2026-07-01', periodTo: '2026-08-31',
  longTermGoal: '住み慣れた自宅で安全に生活を継続する',
  shortTermGoal: '屋内での歩行を安定させ、トイレまで安全に移動できる',
  checkedItems: [], generatedText: '本文',
  ...over,
});

const all = (r: ReturnType<typeof buildMonitoringReport>) =>
  [r.title, r.headerLeft, ...r.headerRight, ...r.columnTitles, r.footer,
    ...r.rows.flatMap((x) => [x.goalCell, x.implementationCell, x.achievementCell, x.directionCell]),
  ].join('\n');

describe('R-01 様式の骨格', () => {
  it('表題・氏名・実施日・実施者・事業所名の欄がある', () => {
    const r = buildMonitoringReport(rec(), '山田太郎', 'さくらデイサービス');
    expect(r.title).toBe('モニタリング報告');
    expect(r.headerLeft).toContain('ご利用者氏名');
    expect(r.headerLeft).toContain('山田太郎');
    expect(r.headerLeft).toContain('様');
    expect(r.headerRight[0]).toContain('モニタリング実施日');
    expect(r.headerRight[1]).toContain('モニタリング実施者');
    expect(r.footer).toContain('事業所名');
    expect(r.footer).toContain('さくらデイサービス');
  });

  it('4列の見出しが紙の様式と同じ', () => {
    expect(buildMonitoringReport(rec(), '山田').columnTitles)
      .toEqual(['目標', '実施状況', '目標の達成度・満足度', '今後の方向性']);
  });

  it('長期目標・短期目標の2行がある', () => {
    const r = buildMonitoringReport(rec(), '山田');
    expect(r.rows.map((x) => x.title)).toEqual(['長期目標', '短期目標']);
    expect(r.rows[0].goalCell).toContain('住み慣れた自宅で安全に生活を継続する');
    expect(r.rows[1].goalCell).toContain('屋内での歩行を安定させ');
  });

  it('各行に期間欄がある', () => {
    const r = buildMonitoringReport(rec({
      longTermAssessment: { periodFrom: '2026-04-01', periodTo: '2027-03-31' },
    }), '山田');
    expect(r.rows[0].goalCell).toContain('期間：2026年4月1日 ～ 2027年3月31日');
    // 未入力なら紙と同じ空欄表記
    expect(r.rows[1].goalCell).toContain('期間：　年　月　日 ～ 　年　月　日');
  });
});

describe('R-02 チェックボックス', () => {
  it('選択したものだけ☑になる', () => {
    const r = buildMonitoringReport(rec({
      longTermAssessment: {
        implementation: '一部実施できた',
        achievement: '一部達成',
        satisfaction: 'ある程度満足',
        direction: 'サービスを継続',
      },
    }), '山田');
    const cell = r.rows[0];
    expect(cell.implementationCell).toContain('☑ 一部実施できた');
    expect(cell.implementationCell).toContain('□ 計画通り実施できた');
    expect(cell.implementationCell).toContain('□ 未実施');
    expect(cell.achievementCell).toContain('☑ 一部達成');
    expect(cell.achievementCell).toContain('☑ ある程度満足');
    expect(cell.achievementCell).toContain('□ 満足');
    expect(cell.directionCell).toContain('☑ サービスを継続');
    expect(cell.directionCell).toContain('□ サービスを中止');
  });

  it('未選択なら☑がひとつも付かない', () => {
    const r = buildMonitoringReport(rec(), '山田');
    expect(all(r)).not.toContain('☑');
    expect(r.rows[0].implementationCell).toContain('□ 計画通り実施できた');
  });

  it('選択肢が紙の様式と一致している', () => {
    expect([...IMPLEMENTATION_OPTIONS]).toEqual(['計画通り実施できた', '一部実施できた', '未実施']);
    expect([...ACHIEVEMENT_OPTIONS]).toEqual(['達成', '一部達成', '未達成']);
    expect([...SATISFACTION_OPTIONS]).toEqual(['満足', 'ある程度満足', '不満']);
    expect([...DIRECTION_OPTIONS])
      .toEqual(['サービスを継続', 'サービス内容変更して継続', 'サービスを中止']);
  });

  it('checkbox の表記', () => {
    expect(checkbox('達成', true)).toBe('☑ 達成');
    expect(checkbox('達成', false)).toBe('□ 達成');
  });
});

describe('R-03 入力されていない情報を作らない', () => {
  it('実施日が未入力なら空欄の様式表記のまま', () => {
    const r = buildMonitoringReport(rec(), '山田');
    expect(r.headerRight[0]).toContain('　　年　　月　　日');
    expect(r.headerRight[0]).not.toMatch(/\d{4}年/);
  });

  it('実施者・事業所名が未入力でも勝手に埋めない', () => {
    const r = buildMonitoringReport(rec(), '山田');
    expect(r.headerRight[1]).toBe('モニタリング実施者：');
    expect(r.footer).toBe('事業所名：　');
  });

  it('既存の評価は同じ言葉のときだけ引き継ぐ', () => {
    expect(inheritAchievement(undefined, '達成')).toBe('達成');
    expect(inheritAchievement(undefined, '一部達成')).toBe('一部達成');
    expect(inheritAchievement(undefined, '未達成')).toBe('未達成');
    // 「概ね達成」「評価困難」は3択に無いので引き継がない
    expect(inheritAchievement(undefined, '概ね達成')).toBeUndefined();
    expect(inheritAchievement(undefined, '評価困難')).toBeUndefined();
    expect(inheritAchievement(undefined, undefined)).toBeUndefined();
    // 専用欄が入力されていればそちらが優先
    expect(inheritAchievement({ achievement: '達成' }, '未達成')).toBe('達成');
  });

  it('「評価困難」だけの記録では達成度に☑が付かない', () => {
    const r = buildMonitoringReport(rec({ longTermEvaluation: '評価困難' }), '山田');
    expect(r.rows[0].achievementCell).not.toContain('☑');
  });
});

describe('R-04 具体的な理由等', () => {
  it('専用欄があればそれを使う', () => {
    const r = buildMonitoringReport(rec({
      longTermAssessment: { reason: '通所回数が確保できたため' },
      longTermComment: '古いコメント',
    }), '山田');
    expect(r.rows[0].implementationCell).toContain('通所回数が確保できたため');
    expect(r.rows[0].implementationCell).not.toContain('古いコメント');
  });

  it('専用欄が未入力なら既存の評価コメントを使う', () => {
    const r = buildMonitoringReport(rec({ longTermComment: '外出の機会が増えている' }), '山田');
    expect(r.rows[0].implementationCell).toContain('外出の機会が増えている');
  });

  it('どちらも未入力なら理由欄は空のまま', () => {
    const r = buildMonitoringReport(rec(), '山田');
    expect(r.rows[0].implementationCell.trimEnd().endsWith('具体的な理由等')).toBe(true);
  });
});

describe('R-05 ファイル名', () => {
  it('実施日を優先し、施設名は含めない', () => {
    const r = buildMonitoringReport(rec({ monitoringDate: '2026-09-05' }), '山田太郎', 'さくらデイサービス');
    expect(r.fileName).toBe('monitoring_山田太郎_2026-09-05.xlsx');
    expect(r.fileName).not.toContain('さくら');
  });

  it('実施日が無ければ期間の終了日を使う', () => {
    expect(buildMonitoringReport(rec(), '山田').fileName)
      .toBe('monitoring_山田_2026-08-31.xlsx');
  });
});

describe('R-06 出力前の確認と事業所名の受け渡し', () => {
  it('確認しなければ出力しない', async () => {
    const exporter = vi.fn();
    const r = await requestMonitoringExcelExport(rec(), '山田', () => false, exporter, 'さくら');
    expect(r).toBeNull();
    expect(exporter).not.toHaveBeenCalled();
  });

  it('確認したら事業所名つきで出力処理へ渡る', async () => {
    const exporter = vi.fn().mockResolvedValue('ok.xlsx');
    await requestMonitoringExcelExport(rec(), '山田', () => true, exporter, 'さくらデイサービス');
    expect(exporter).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'm-1' }), '山田', 'さくらデイサービス');
  });
});

describe('R-07 既存データの互換性', () => {
  it('v0.5.2までの記録（様式欄なし）でも様式を作れる', () => {
    const old = rec(); // longTermAssessment などが無い
    const r = buildMonitoringReport(old, '山田');
    expect(r.rows).toHaveLength(2);
    expect(all(r)).toContain('目標の達成度・満足度');
    expect(all(r)).not.toContain('undefined');
  });

  it('目標が未入力でも落ちない', () => {
    const r = buildMonitoringReport(rec({ longTermGoal: '', shortTermGoal: '' }), '山田');
    expect(r.rows[0].goalCell).toContain('長期目標');
    expect(all(r)).not.toContain('undefined');
  });
});
