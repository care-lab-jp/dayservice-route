/**
 * 五十音の並べ替え・絞り込みと、月次モニタリングのテスト。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KANA_ROWS, compareByReading, countByRow, filterByRow, kanaRowOf, readingOf,
  sortByReading, toHiragana,
} from '../kana';
import {
  addMonthsAsPeriodEnd, availableYears, coversDate, daysInMonth, findMonthly,
  goalForMonth, goalHistory, goalOnDate, isEmptyMonthly, monitorNameSuggestions,
  monthRange, monthsWithData, parseDate, sheetNameOf, shortTermEndDate,
} from '../monitoringYear';
import {
  buildMonthSheetModel, checkLine, dateOrBlank, monitoringFileName, BLANK_DATE,
} from '../monitoringWorkbook';
import { newGoalTermId, newMonthlyId, useAppStore } from '../../store/useAppStore';
import { sampleMembers } from '../../data/sampleData';
import type { MonitoringGoalTerm, MonitoringMonthlyRecord } from '../../types';

const m = (name: string, kana?: string) => ({ id: name, name, kana });

const goal = (o: Partial<MonitoringGoalTerm>): MonitoringGoalTerm => ({
  goalTermId: o.goalTermId ?? newGoalTermId(),
  memberId: 'm-1', kind: 'short', text: '目標', startDate: '2026-04-01', endDate: '',
  createdAt: '', updatedAt: '', ...o,
});

const monthly = (o: Partial<MonitoringMonthlyRecord>): MonitoringMonthlyRecord => ({
  monthlyId: o.monthlyId ?? newMonthlyId(),
  memberId: 'm-1', year: 2026, month: 4,
  longTerm: {}, shortTerm: {}, createdAt: '', updatedAt: '', ...o,
});

describe('L-01 あいうえお順', () => {
  it('ふりがなで並べ替えられる', () => {
    const list = [m('山田', 'やまだ'), m('田中', 'たなか'), m('鈴木', 'すずき'), m('青木', 'あおき')];
    expect(sortByReading(list).map((x) => x.name)).toEqual(['青木', '鈴木', '田中', '山田']);
  });

  it('ふりがなが無くても落ちない', () => {
    const list = [m('渡辺'), m('伊藤', 'いとう'), m('大野')];
    expect(sortByReading(list)).toHaveLength(3);
  });

  it('カタカナのふりがなもひらがなとして扱う', () => {
    expect(toHiragana('ヤマダ')).toBe('やまだ');
    expect(readingOf(m('山田', 'ヤマダ'))).toBe('やまだ');
    expect(compareByReading(m('山田', 'ヤマダ'), m('山田', 'やまだ'))).toBe(0);
  });

  it('元の配列を書き換えない', () => {
    const list = [m('山田', 'やまだ'), m('青木', 'あおき')];
    sortByReading(list);
    expect(list[0].name).toBe('山田');
  });
});

describe('L-02 五十音の絞り込み', () => {
  const list = [
    m('青木', 'あおき'), m('井上', 'いのうえ'),
    m('加藤', 'かとう'), m('久保', 'くぼ'),
    m('佐藤', 'さとう'), m('田中', 'たなか'),
    m('渡辺', 'わたなべ'),
  ];

  it('あ行で絞り込める', () => {
    expect(filterByRow(list, 'あ').map((x) => x.name)).toEqual(['青木', '井上']);
  });

  it('か行で絞り込める', () => {
    expect(filterByRow(list, 'か').map((x) => x.name)).toEqual(['加藤', '久保']);
  });

  it('全員表示に戻せる', () => {
    expect(filterByRow(list, null)).toHaveLength(list.length);
  });

  it('利用者がいない行でも落ちない', () => {
    expect(filterByRow(list, 'な')).toEqual([]);
    expect(filterByRow([], 'あ')).toEqual([]);
  });

  it('濁点・半濁点・小文字も正しい行に入る', () => {
    expect(kanaRowOf(m('学', 'がく'))).toBe('か');
    expect(kanaRowOf(m('傍島', 'そばじま'))).toBe('さ');
    expect(kanaRowOf(m('番場', 'ばんば'))).toBe('は');
    expect(kanaRowOf(m('パン', 'ぱん'))).toBe('は');
  });

  it('判定できない名前は null', () => {
    expect(kanaRowOf(m('Smith', 'smith'))).toBeNull();
    expect(kanaRowOf(m(''))).toBeNull();
  });

  it('行ごとの人数を数えられる', () => {
    const c = countByRow(list);
    expect(c['あ']).toBe(2);
    expect(c['か']).toBe(2);
    expect(c['な']).toBe(0);
    expect(Object.keys(c)).toHaveLength(KANA_ROWS.length);
  });
});

describe('M-01 短期目標の期間', () => {
  it('開始日から6か月間の終了日を計算する', () => {
    expect(shortTermEndDate('2026-04-01')).toBe('2026-09-30');
    expect(shortTermEndDate('2026-01-01')).toBe('2026-06-30');
    expect(shortTermEndDate('2026-07-15')).toBe('2027-01-14');
  });

  it('月末開始でも破綻しない', () => {
    expect(shortTermEndDate('2026-08-31')).toBe('2027-02-27');
    expect(addMonthsAsPeriodEnd('2026-01-31', 1)).toBe('2026-02-27');
  });

  it('不正な日付なら空文字', () => {
    expect(shortTermEndDate('')).toBe('');
    expect(shortTermEndDate('2026/04/01')).toBe('');
  });

  it('日付の分解と月の日数', () => {
    expect(parseDate('2026-04-01')).toEqual({ y: 2026, m: 4, d: 1 });
    expect(parseDate('2026-13-01')).toBeNull();
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(monthRange(2026, 4)).toEqual({ from: '2026-04-01', to: '2026-04-30' });
  });
});

describe('M-02 目標の履歴と月ごとの適用', () => {
  const terms = [
    goal({ goalTermId: 'A', text: '目標A', startDate: '2026-04-01', endDate: '2026-06-30' }),
    goal({ goalTermId: 'B', text: '目標B', startDate: '2026-07-01', endDate: '' }),
  ];

  it('4〜6月は目標A、7月以降は目標B', () => {
    expect(goalForMonth(terms, 'm-1', 'short', 2026, 4)?.text).toBe('目標A');
    expect(goalForMonth(terms, 'm-1', 'short', 2026, 6)?.text).toBe('目標A');
    expect(goalForMonth(terms, 'm-1', 'short', 2026, 7)?.text).toBe('目標B');
    expect(goalForMonth(terms, 'm-1', 'short', 2026, 12)?.text).toBe('目標B');
  });

  it('期間前の月には目標が無い', () => {
    expect(goalForMonth(terms, 'm-1', 'short', 2026, 3)).toBeNull();
  });

  it('他の利用者・他の種別は混ざらない', () => {
    expect(goalForMonth(terms, 'm-2', 'short', 2026, 4)).toBeNull();
    expect(goalForMonth(terms, 'm-1', 'long', 2026, 4)).toBeNull();
  });

  it('日付での判定', () => {
    expect(coversDate(terms[0], '2026-05-01')).toBe(true);
    expect(coversDate(terms[0], '2026-07-01')).toBe(false);
    expect(goalOnDate(terms, 'm-1', 'short', '2026-08-01')?.text).toBe('目標B');
  });

  it('履歴は新しい順に並ぶ', () => {
    expect(goalHistory(terms, 'm-1', 'short').map((t) => t.goalTermId)).toEqual(['B', 'A']);
  });
});

describe('M-03 月ごとの記録', () => {
  beforeEach(() => {
    useAppStore.setState({ monitoringMonthly: [], monitoringGoalTerms: [] });
  });

  it('1月〜12月を個別に保存できる', () => {
    const s = useAppStore.getState();
    [1, 5, 12].forEach((mm) => s.saveMonthly(monthly({ month: mm, monitorName: `担当${mm}` })));
    const list = useAppStore.getState().monitoringMonthly;
    expect(list).toHaveLength(3);
    expect(monthsWithData(list, 'm-1', 2026)).toEqual([1, 5, 12]);
  });

  it('同じ年月に保存すると置き換わる', () => {
    const s = useAppStore.getState();
    s.saveMonthly(monthly({ month: 4, monitorName: '最初' }));
    s.saveMonthly(monthly({ month: 4, monitorName: 'あとから' }));
    const list = useAppStore.getState().monitoringMonthly;
    expect(list).toHaveLength(1);
    expect(list[0].monitorName).toBe('あとから');
  });

  it('ある月を編集しても他の月は変わらない', () => {
    const s = useAppStore.getState();
    s.saveMonthly(monthly({ month: 4, monitorName: '4月担当' }));
    s.saveMonthly(monthly({ month: 5, monitorName: '5月担当' }));
    useAppStore.getState().saveMonthly(
      monthly({ month: 4, monitorName: '4月修正', longTerm: { achievement: '達成' } })
    );
    const list = useAppStore.getState().monitoringMonthly;
    expect(findMonthly(list, 'm-1', 2026, 4)!.monitorName).toBe('4月修正');
    expect(findMonthly(list, 'm-1', 2026, 5)!.monitorName).toBe('5月担当');
    expect(findMonthly(list, 'm-1', 2026, 5)!.longTerm.achievement).toBeUndefined();
  });

  it('利用者ごとに別データとして保存される', () => {
    const s = useAppStore.getState();
    s.saveMonthly(monthly({ memberId: 'm-1', month: 4 }));
    s.saveMonthly(monthly({ memberId: 'm-2', month: 4 }));
    const list = useAppStore.getState().monitoringMonthly;
    expect(findMonthly(list, 'm-1', 2026, 4)).toBeTruthy();
    expect(findMonthly(list, 'm-2', 2026, 4)).toBeTruthy();
    expect(list).toHaveLength(2);
  });

  it('年が違えば別の記録になる', () => {
    const s = useAppStore.getState();
    s.saveMonthly(monthly({ year: 2025, month: 4 }));
    s.saveMonthly(monthly({ year: 2026, month: 4 }));
    expect(useAppStore.getState().monitoringMonthly).toHaveLength(2);
    expect(availableYears(useAppStore.getState().monitoringMonthly, 'm-1', new Date('2026-08-01')))
      .toEqual([2026, 2025]);
  });

  it('空の記録を判定できる', () => {
    expect(isEmptyMonthly(monthly({}))).toBe(true);
    expect(isEmptyMonthly(monthly({ monitorName: '担当' }))).toBe(false);
    expect(isEmptyMonthly(monthly({ longTerm: { achievement: '達成' } }))).toBe(false);
  });
});

describe('M-04 目標変更後も過去の記録が変わらない', () => {
  beforeEach(() => {
    useAppStore.setState({ monitoringMonthly: [], monitoringGoalTerms: [] });
  });

  it('保存した月の目標は、あとで目標を変えても書き換わらない', () => {
    const s = useAppStore.getState();
    s.addGoalTerm(goal({ goalTermId: 'A', text: '目標A', startDate: '2026-04-01' }));
    s.saveMonthly(monthly({ month: 4, shortGoalText: '目標A', shortGoalTermId: 'A' }));

    useAppStore.getState().updateGoalTerm('A', { endDate: '2026-06-30' });
    useAppStore.getState().addGoalTerm(
      goal({ goalTermId: 'B', text: '目標B', startDate: '2026-07-01' })
    );
    useAppStore.getState().saveMonthly(
      monthly({ month: 7, shortGoalText: '目標B', shortGoalTermId: 'B' })
    );

    const list = useAppStore.getState().monitoringMonthly;
    expect(findMonthly(list, 'm-1', 2026, 4)!.shortGoalText).toBe('目標A');
    expect(findMonthly(list, 'm-1', 2026, 7)!.shortGoalText).toBe('目標B');
  });

  it('目標を履歴から削除しても、保存済みの月の記録は残る', () => {
    const s = useAppStore.getState();
    s.addGoalTerm(goal({ goalTermId: 'A', text: '目標A' }));
    s.saveMonthly(monthly({ month: 4, shortGoalText: '目標A', shortGoalTermId: 'A' }));
    useAppStore.getState().removeGoalTerm('A');
    expect(useAppStore.getState().monitoringMonthly[0].shortGoalText).toBe('目標A');
  });
});

describe('M-05 実施者', () => {
  it('過去に使った実施者を新しい順・重複なしで候補にする', () => {
    const list = [
      monthly({ monitorName: '福山 高弘', updatedAt: '2026-08-01T00:00:00.000Z' }),
      monthly({ monitorName: '介護 花子', updatedAt: '2026-07-01T00:00:00.000Z' }),
      monthly({ monitorName: '福山 高弘', updatedAt: '2026-06-01T00:00:00.000Z' }),
      monthly({ monitorName: '', updatedAt: '2026-05-01T00:00:00.000Z' }),
    ];
    expect(monitorNameSuggestions(list)).toEqual(['福山 高弘', '介護 花子']);
  });

  it('記録ごとに実施者を保存する', () => {
    useAppStore.setState({ monitoringMonthly: [] });
    const s = useAppStore.getState();
    s.saveMonthly(monthly({ month: 4, monitorName: 'Aさん' }));
    s.saveMonthly(monthly({ month: 5, monitorName: 'Bさん' }));
    const list = useAppStore.getState().monitoringMonthly;
    expect(findMonthly(list, 'm-1', 2026, 4)!.monitorName).toBe('Aさん');
    expect(findMonthly(list, 'm-1', 2026, 5)!.monitorName).toBe('Bさん');
  });
});

describe('M-06 Excelの中身（原本様式）', () => {
  it('シート名は原本と同じ「西暦,月」形式', () => {
    expect(sheetNameOf(2026, 7)).toBe('2026,7');
    expect(sheetNameOf(2026, 12)).toBe('2026,12');
  });

  it('未入力の項目は☐のまま、選んだものだけ☑になる', () => {
    const model = buildMonthSheetModel(
      monthly({ longTerm: { implementation: '一部実施できた', achievement: '一部達成' } }),
      { year: 2026, month: 4, memberName: '山田太郎' }
    );
    expect(model.long.implementation).toContain('☑一部実施できた');
    expect(model.long.implementation).toContain('☐計画通り実施できた');
    expect(model.long.achievement).toContain('☑一部達成');
    expect(model.long.satisfaction.every((l) => l.startsWith('☐'))).toBe(true);
    expect(model.long.direction.every((l) => l.startsWith('☐'))).toBe(true);
  });

  it('記録が無い月は原本と同じ空欄表記になる', () => {
    const model = buildMonthSheetModel(null, { year: 2026, month: 4, memberName: '山田太郎' });
    expect(model.implementedText).toContain(BLANK_DATE);
    expect(model.long.periodFrom).toBe(`${BLANK_DATE}～`);
    expect(model.long.goalText).toBe('');
    expect(model.short.implementation.every((l) => l.startsWith('☐'))).toBe(true);
  });

  it('氏名・実施者・事業所名が入る', () => {
    const model = buildMonthSheetModel(
      monthly({ monitorName: '福山　高弘', implementedOn: '2026-07-10' }),
      { year: 2026, month: 7, memberName: '山田太郎', officeName: 'ウエルプラス' }
    );
    expect(model.memberNameText).toContain('山田太郎');
    expect(model.monitorText).toContain('福山　高弘');
    expect(model.officeText).toContain('ウエルプラス');
    expect(model.implementedText).toContain('2026年7月10日');
  });

  it('記録時点の目標が各月に入る（目標変更前後で分かれる）', () => {
    const apr = buildMonthSheetModel(
      monthly({ month: 4, shortGoalText: '目標A', longGoalText: '長期A' }),
      { year: 2026, month: 4, memberName: '山田' }
    );
    const jul = buildMonthSheetModel(
      monthly({ month: 7, shortGoalText: '目標B', longGoalText: '長期A' }),
      { year: 2026, month: 7, memberName: '山田' }
    );
    expect(apr.short.goalText).toBe('目標A');
    expect(jul.short.goalText).toBe('目標B');
    expect(apr.long.goalText).toBe('長期A');
  });

  it('日付表記とチェック記号', () => {
    expect(dateOrBlank('2026-07-10')).toBe('　2026年7月10日');
    expect(dateOrBlank('')).toBe(BLANK_DATE);
    expect(checkLine('達成', true)).toBe('☑達成');
    expect(checkLine('達成', false)).toBe('☐達成');
  });

  it('ファイル名に施設名を含めない', () => {
    expect(monitoringFileName('山田太郎', 2026)).toBe('monitoring_山田太郎_2026.xlsx');
    expect(monitoringFileName('山田/太郎 ', 2026)).not.toMatch(/[\\/\s]/);
  });

  it('1月〜12月の12シートを作る', async () => {
    const { buildMonitoringYearWorkbook } = await import('../monitoringWorkbook');
    const records = new Map<number, MonitoringMonthlyRecord | null>();
    records.set(7, monthly({ month: 7, monitorName: '福山' }));
    const { wb } = await buildMonitoringYearWorkbook({
      memberName: '山田太郎', officeName: 'ウエルプラス', year: 2026, records,
    });
    const names = wb.worksheets.map((w: { name: string }) => w.name);
    expect(names).toHaveLength(12);
    expect(names[0]).toBe('2026,1');
    expect(names[11]).toBe('2026,12');
  });

  it('原本と同じセルに値と書式が入る', async () => {
    const { buildMonitoringYearWorkbook } = await import('../monitoringWorkbook');
    const records = new Map<number, MonitoringMonthlyRecord | null>();
    records.set(7, monthly({
      month: 7, monitorName: '福山　高弘', implementedOn: '2026-07-10',
      longGoalText: '長期の目標', shortGoalText: '短期の目標',
      longTerm: { implementation: '一部実施できた' },
    }));
    const { wb } = await buildMonitoringYearWorkbook({
      memberName: '山田太郎', officeName: 'ウエルプラス', year: 2026, records,
    });
    const ws = wb.getWorksheet('2026,7')!;
    expect(String(ws.getCell('A1').value)).toBe('モニタリング報告');
    expect(String(ws.getCell('A5').value)).toBe('目標');
    expect(String(ws.getCell('E5').value)).toBe('実施状況');
    expect(String(ws.getCell('I5').value)).toBe('目標の達成度・満足度');
    expect(String(ws.getCell('M5').value)).toBe('今後の方向性');
    expect(String(ws.getCell('A6').value)).toBe('長期目標');
    expect(String(ws.getCell('A16').value)).toBe('短期目標');
    expect(String(ws.getCell('A10').value)).toBe('長期の目標');
    expect(String(ws.getCell('A20').value)).toBe('短期の目標');
    expect(String(ws.getCell('E7').value)).toBe('☑一部実施できた');
    expect(String(ws.getCell('E10').value)).toBe('具体的な理由等');
    expect(String(ws.getCell('I11').value)).toBe('本人満足度');
    expect(String(ws.getCell('K27').value)).toContain('ウエルプラス');
    expect(ws.getCell('A1').font?.size).toBe(22);
    expect(ws.getCell('A5').font?.name).toBe('ＭＳ Ｐゴシック');
    expect(ws.getCell('A6').border?.top?.style).toBe('medium');
    expect(ws.getCell('K27').border?.bottom?.style).toBe('thin');
  });

  it('データが正しい月のシートに入る', async () => {
    const { buildMonitoringYearWorkbook } = await import('../monitoringWorkbook');
    const records = new Map<number, MonitoringMonthlyRecord | null>();
    records.set(4, monthly({ month: 4, shortGoalText: '目標A', monitorName: 'Aさん' }));
    records.set(7, monthly({ month: 7, shortGoalText: '目標B', monitorName: 'Bさん' }));
    const { wb } = await buildMonitoringYearWorkbook({
      memberName: '山田', year: 2026, records,
    });
    expect(String(wb.getWorksheet('2026,4')!.getCell('A20').value)).toBe('目標A');
    expect(String(wb.getWorksheet('2026,7')!.getCell('A20').value)).toBe('目標B');
    expect(String(wb.getWorksheet('2026,4')!.getCell('K3').value)).toContain('Aさん');
    expect(String(wb.getWorksheet('2026,7')!.getCell('K3').value)).toContain('Bさん');
    // 記録の無い月は空欄の様式
    expect(String(wb.getWorksheet('2026,1')!.getCell('A20').value)).toBe('');
  });
});

describe('M-07 送迎機能への非干渉', () => {
  it('ふりがなは送迎表の指紋に含まれない', async () => {
    const { memberFingerprint } = await import('../freshness');
    const base = sampleMembers[0];
    expect(memberFingerprint(base)).toBe(memberFingerprint({ ...base, kana: 'ちがうよみ' }));
  });

  it('モニタリングを保存しても送迎表は作り直しにならない', async () => {
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

    useAppStore.setState({ monitoringMonthly: [], monitoringGoalTerms: [] });
    useAppStore.getState().saveMonthly(monthly({ memberId: sampleMembers[0].id, month: 4 }));
    useAppStore.getState().addGoalTerm(goal({ memberId: sampleMembers[0].id }));

    expect(planFreshness(dayPlan, ctx).status).toBe('READY');
  });

  it('モニタリングの処理で通信APIを呼ばない', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    buildMonthSheetModel(monthly({ monitorName: '福山' }), {
      year: 2026, month: 7, memberName: '山田太郎', officeName: 'ウエルプラス',
    });
    goalForMonth([goal({})], 'm-1', 'short', 2026, 4);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('関連モジュールに外部通信の記述がない', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    ['kana.ts', 'monitoringYear.ts', 'monitoringWorkbook.ts'].forEach((f) => {
      const src = readFileSync(join(process.cwd(), 'src', 'lib', f), 'utf8');
      ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'openai'].forEach((w) => {
        expect(src, `${f} に ${w} が含まれています`).not.toContain(w);
      });
    });
  });
});

describe('M-08 前回・目標からの引用', () => {
  it('目標の期間を評価欄の期間として引用できる', async () => {
    const { periodFromGoal } = await import('../monitoringYear');
    expect(periodFromGoal(goal({ startDate: '2026-04-01', endDate: '2026-09-30' })))
      .toEqual({ periodFrom: '2026-04-01', periodTo: '2026-09-30' });
    // 終了日が未定なら空のまま（勝手に埋めない）
    expect(periodFromGoal(goal({ startDate: '2026-04-01', endDate: '' })))
      .toEqual({ periodFrom: '2026-04-01', periodTo: undefined });
    expect(periodFromGoal(null)).toEqual({});
  });

  it('前回の月の記録を見つけられる', async () => {
    const { previousMonthlyRecord } = await import('../monitoringYear');
    const list = [
      monthly({ year: 2026, month: 4 }),
      monthly({ year: 2026, month: 6 }),
      monthly({ year: 2025, month: 12 }),
    ];
    expect(previousMonthlyRecord(list, 'm-1', 2026, 7)?.month).toBe(6);
    expect(previousMonthlyRecord(list, 'm-1', 2026, 5)?.month).toBe(4);
    // 年をまたいでも直前を選ぶ
    expect(previousMonthlyRecord(list, 'm-1', 2026, 1)?.year).toBe(2025);
    // それより前が無ければ null
    expect(previousMonthlyRecord(list, 'm-1', 2025, 1)).toBeNull();
    // 他の利用者は対象外
    expect(previousMonthlyRecord(list, 'm-2', 2026, 7)).toBeNull();
  });

  it('前回の評価欄だけを引用する（実施日・目標本文は引き継がない）', async () => {
    const { carryOverAssessments } = await import('../monitoringYear');
    const prev = monthly({
      month: 6, implementedOn: '2026-06-10', monitorName: '福山',
      longGoalText: '当時の長期目標', shortGoalText: '当時の短期目標',
      longTerm: {
        periodFrom: '2026-04-01', periodTo: '2027-03-31',
        implementation: '一部実施できた', achievement: '一部達成',
        satisfaction: 'ある程度満足', direction: 'サービスを継続',
        reason: '前回の理由',
      },
      shortTerm: { implementation: '計画通り実施できた' },
    });
    const carried = carryOverAssessments(prev);

    expect(carried.longTerm.implementation).toBe('一部実施できた');
    expect(carried.longTerm.achievement).toBe('一部達成');
    expect(carried.longTerm.satisfaction).toBe('ある程度満足');
    expect(carried.longTerm.direction).toBe('サービスを継続');
    expect(carried.longTerm.reason).toBe('前回の理由');
    expect(carried.longTerm.periodFrom).toBe('2026-04-01');
    expect(carried.shortTerm.implementation).toBe('計画通り実施できた');
    // 引き継がないもの
    expect(Object.keys(carried)).toEqual(['longTerm', 'shortTerm']);
  });

  it('引用しても前回の記録は書き換わらない', async () => {
    const { carryOverAssessments } = await import('../monitoringYear');
    const prev = monthly({ month: 6, longTerm: { reason: '前回の理由' } });
    const carried = carryOverAssessments(prev);
    carried.longTerm.reason = '書き換えた';
    expect(prev.longTerm.reason).toBe('前回の理由');
  });
});
