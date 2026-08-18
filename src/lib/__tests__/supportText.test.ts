/**
 * 支援記録の文章づくりのテスト。
 * 最重要の観点は「入力されていない事実を作らないこと」と「外部通信をしないこと」。
 */
import { describe, expect, it, vi } from 'vitest';
import { buildSupportText, displayTextOf } from '../supportText';
import { SUPPORT_ITEMS, itemsOf } from '../supportCatalog';
import type { SupportRecord } from '../../types';

const build = (
  checkedItems: string[],
  extra: Partial<Parameters<typeof buildSupportText>[0]> = {}
) => buildSupportText({ checkedItems, ...extra }).text;

describe('T-NEW-01 チェックなし', () => {
  it('無理に内容を作らず、今後の一文だけを返す', () => {
    const t = build([]);
    expect(t).toBe('今後も現在の状態の維持を目指し、支援を継続します。');
    expect(t).not.toMatch(/改善|向上|延長/);
  });
});

describe('T-NEW-02 「歩行距離が伸びた」のみ', () => {
  it('歩行距離の変化だけが文章になる', () => {
    const t = build(['walk-distance']);
    expect(t).toContain('現在、歩行距離の延長がみられています。');
    expect(t).not.toContain('訓練');
    expect(t).not.toContain('希望');
  });
});

describe('T-NEW-03 「下肢筋力訓練」のみ', () => {
  it('支援内容だけが文章になる', () => {
    const t = build(['sup-lower']);
    expect(t).toContain('下肢筋力訓練に取り組んでいます。');
    expect(t).not.toMatch(/みられています/);
  });
});

describe('T-NEW-04 複数チェック', () => {
  it('重複せず、4ブロックが自然につながる', () => {
    const t = build(['walk-distance', 'stand-up', 'sup-lower', 'sup-gait', 'wish-walk']);
    expect(t).toContain('歩行距離の延長、立ち上がり動作の安定がみられています。');
    expect(t).toContain('下肢筋力訓練、歩行訓練に取り組んでいます。');
    expect(t).toContain('本人は、自分で歩くことを希望しています。');
    expect(t).toContain('今後も現在の身体機能の維持・向上を目指し、支援を継続します。');
    // 「みられています」は1回だけ
    expect(t.match(/みられています/g)?.length).toBe(1);
  });

  it('同じ項目を重ねて渡しても文が二重にならない', () => {
    const t = buildSupportText({ checkedItems: ['sup-lower', 'sup-lower'] }).text;
    expect(t.match(/下肢筋力訓練/g)?.length).toBe(2); // 名詞の連結としては2回だが…
    expect(t.match(/取り組んでいます/g)?.length).toBe(1); // 文としては1回
  });
});

describe('T-NEW-05 数値あり', () => {
  it('入力した10m→30mがそのまま文章に反映される', () => {
    const t = build(['walk-distance'], {
      baseline: { walkDistanceM: 10 },
      current: { walkDistanceM: 30 },
    });
    expect(t).toContain('歩行距離は10mから30mに延長しています。');
    expect(t).toContain('利用開始時と比較して');
  });

  it('数値が減っていれば減ったと書く（改善に読み替えない）', () => {
    const t = build([], { baseline: { walkDistanceM: 30 }, current: { walkDistanceM: 10 } });
    expect(t).toContain('歩行距離は30mから10mに短縮しています。');
    expect(t).not.toContain('延長');
  });

  it('片方だけの入力では数値を出さない', () => {
    expect(build(['walk-distance'], { baseline: { walkDistanceM: 10 } })).not.toMatch(/[0-9]+m/);
    expect(build(['walk-distance'], { current: { walkDistanceM: 30 } })).not.toMatch(/[0-9]+m/);
  });

  it('選択式の項目も入力された値だけを使う', () => {
    const t = build([], {
      baseline: { gait: '一部介助' },
      current: { gait: '見守り' },
    });
    expect(t).toContain('歩行状態は「一部介助」から「見守り」に変化しています。');
    expect(t).not.toContain('立ち上がり');
    expect(t).not.toContain('介助量は');
  });

  it('開始時と現在が同じ値なら「変化」と書かない', () => {
    const t = build([], { baseline: { gait: '見守り' }, current: { gait: '見守り' } });
    expect(t).not.toContain('歩行状態');
  });
});

describe('T-NEW-06 / T-NEW-07 数値・期間を勝手に作らない', () => {
  it('数値を入力していなければ文章に数字が出ない', () => {
    const t = build(['walk-distance', 'stand-up', 'sup-lower', 'wish-walk']);
    expect(t).not.toMatch(/[0-9]/);
  });

  it('期間・程度・断定の表現が出ない', () => {
    const all = SUPPORT_ITEMS.map((i) => i.id);
    const t = build(all, { note: '' });
    const forbidden = [
      'か月', 'ヶ月', 'カ月', '週間', '半年', '年間', '日間',
      '大幅', '著しく', 'かなり', '劇的', 'とても', '非常に',
      '完治', '治った', '治癒', '回復しました',
      'と思われ', '推測', 'おそらく', 'ようだ',
      'AI', '自動判定', '評価しました',
    ];
    forbidden.forEach((w) => expect(t).not.toContain(w));
  });

  it('カタログの定型文そのものに禁止語が含まれない', () => {
    const forbidden = ['か月', '週間', '半年', '大幅', '著しく', '完治', '自立した', 'AI'];
    SUPPORT_ITEMS.forEach((item) => {
      forbidden.forEach((w) => {
        expect(item.noun).not.toContain(w);
        expect(item.label === '大きな変化はない' ? '' : item.noun).not.toContain(w);
      });
    });
  });
});

describe('T-NEW-08 本人の希望', () => {
  it('希望として文章になる', () => {
    const t = build(['wish-toilet']);
    expect(t).toContain('本人は、自分でトイレまで行くことを希望しています。');
  });

  it('複数の希望を並べられる', () => {
    const t = build(['wish-walk', 'wish-nofall']);
    expect(t).toContain('本人は、自分で歩くこと、転倒せずに生活することを希望しています。');
  });
});

describe('T-NEW-09 「大きな変化はない」', () => {
  it('改善したかのような文章を作らない', () => {
    const t = build(['no-change']);
    expect(t).toContain('現在の状態を維持しています。');
    expect(t).not.toMatch(/改善|向上|延長|安定してきて/);
    expect(t).toContain('今後も現在の状態の維持を目指し');
  });
});

describe('T-NEW-10 状態が低下した', () => {
  it('改善表現を出さず、状態の変化として書く', () => {
    const t = build(['decline']);
    expect(t).toContain('状態の低下がみられています。');
    expect(t).not.toMatch(/改善|向上/);
    expect(t).toContain('今後は、状態の変化に留意しながら、必要な支援を継続します。');
  });

  it('改善と低下が同時でも、両方を打ち消さずに併記する', () => {
    const t = build(['walk-distance', 'decline']);
    expect(t).toContain('歩行距離の延長がみられています。');
    expect(t).toContain('状態の低下がみられています。');
    // 今後の方針は慎重側を優先する
    expect(t).toContain('状態の変化に留意しながら');
  });
});

describe('T-NEW-11 外部への送信が発生しない', () => {
  it('文章づくりの間に通信APIが一切呼ばれない', () => {
    const fetchSpy = vi.fn();
    const xhrSpy = vi.fn();
    const beaconSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', class { open = xhrSpy; send = xhrSpy; setRequestHeader = xhrSpy; });
    vi.stubGlobal('navigator', { sendBeacon: beaconSpy });

    buildSupportText({
      checkedItems: SUPPORT_ITEMS.map((i) => i.id),
      baseline: { gait: '一部介助', walkDistanceM: 10 },
      current: { gait: '見守り', walkDistanceM: 30 },
      note: '田中さんのご家族から相談あり',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('文章づくりのモジュールが外部通信を含まない', async () => {
    const src = await import('../supportText');
    const code = Object.values(src).map((v) => String(v)).join('\n');
    ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'axios', 'openai', 'googleapis'].forEach((w) => {
      expect(code).not.toContain(w);
    });
  });
});

describe('補足メモと保存', () => {
  it('補足メモは職員の記述をそのまま末尾に載せる', () => {
    const t = build(['walk-distance'], { note: 'ご家族より自宅での様子について相談あり' });
    expect(t.endsWith('補足：ご家族より自宅での様子について相談あり')).toBe(true);
  });

  it('空白だけのメモは載せない', () => {
    expect(build([], { note: '   ' })).not.toContain('補足');
  });

  it('編集済みの文章があればそちらを表示する', () => {
    const base: SupportRecord = {
      recordId: 'r1', memberId: 'm1',
      createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z',
      checkedItems: [], generatedText: 'もとの文章',
    };
    expect(displayTextOf(base)).toBe('もとの文章');
    expect(displayTextOf({ ...base, editedText: '直した文章' })).toBe('直した文章');
    expect(displayTextOf({ ...base, editedText: '   ' })).toBe('もとの文章');
  });
});

describe('カタログの整合性', () => {
  it('IDが重複していない', () => {
    const ids = SUPPORT_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('4カテゴリすべてに項目がある', () => {
    (['physical', 'adl', 'support', 'wish'] as const).forEach((c) => {
      expect(itemsOf(c).length).toBeGreaterThan(0);
    });
  });

  it('未知のIDを渡しても落ちない', () => {
    expect(() => build(['not-exist'])).not.toThrow();
    expect(build(['not-exist'])).toBe('今後も現在の状態の維持を目指し、支援を継続します。');
  });
});
