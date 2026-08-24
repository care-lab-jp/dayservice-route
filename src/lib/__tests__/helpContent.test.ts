/**
 * ヘルプ本文のテスト。
 * いちばんの目的は「ヘルプと実際の画面が食い違わないこと」。
 * ヘルプに書いたボタン名が本当に画面に存在するかを、ソースを読んで確認している。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HELP_ANCHORS, HELP_SECTIONS, findSection } from '../helpContent';

/** ヘルプ本文をすべて連結した文字列 */
const helpText = HELP_SECTIONS.map((s) =>
  [s.title, s.summary, ...s.blocks.flatMap((b) =>
    b.kind === 'text' ? [b.text] : b.kind === 'note' ? [b.title, ...b.items] : b.items
  )].join('\n')
).join('\n');

/** 画面のソース（ボタン名の存在確認用） */
const uiSource = (() => {
  const root = join(process.cwd(), 'src');
  const files: string[] = [];
  for (const dir of ['pages', 'components']) {
    for (const f of readdirSync(join(root, dir))) {
      if (f.endsWith('.tsx')) files.push(join(root, dir, f));
    }
  }
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
})();

describe('HELP-01 構造', () => {
  it('すべての項目に id・見出し・説明・本文がある', () => {
    expect(HELP_SECTIONS.length).toBeGreaterThanOrEqual(8);
    HELP_SECTIONS.forEach((s) => {
      expect(s.id).toMatch(/^[a-z-]+$/);
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.summary.length).toBeGreaterThan(0);
      expect(s.blocks.length).toBeGreaterThan(0);
    });
  });

  it('idが重複していない', () => {
    const ids = HELP_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('指示された項目がすべてある', () => {
    ['start', 'members', 'route-create', 'route-result', 'rebuild', 'support', 'backup', 'privacy']
      .forEach((id) => expect(findSection(id), `${id} がありません`).toBeTruthy());
  });

  it('各画面のリンク先がすべて実在する', () => {
    Object.values(HELP_ANCHORS).forEach((anchor) => {
      expect(findSection(anchor), `#${anchor} に対応する項目がありません`).toBeTruthy();
    });
  });

  it('1項目あたりの文章が長くなりすぎていない（現場で読める長さ）', () => {
    HELP_SECTIONS.forEach((s) => {
      s.blocks.forEach((b) => {
        const texts = b.kind === 'text' ? [b.text] : b.kind === 'note' ? b.items : b.items;
        texts.forEach((t) => expect(t.length, `長すぎます: ${t}`).toBeLessThanOrEqual(160));
      });
    });
  });
});

describe('HELP-02 画面との食い違いがない', () => {
  // ヘルプに書いてあるボタン名・項目名。実際の画面に存在することを確認する
  const labels = [
    '＋ 新規登録', '住所を入れる', '住所から座標', '無効にする', '支援記録',
    '① 今日の利用者を選ぶ', '② 出発時刻', '③ ルートを作成', '前回と同じ順番で作る',
    'おすすめに合わせる', '印刷する', '5分早める',
    '文章を作成する', '保存する', '開いて修正する',
    'この月の記録を保存する', '前回の内容を引用する', '目標の期間を入れる', 'モニタリングへ',
    'データを書き出す（バックアップ）', 'データを読み込む', '直前の取り込みを取り消す',
    'この端末のデータを削除', '＋ 車両を追加', '停止にする', '施設への到着希望時刻',
  ];

  it.each(labels)('「%s」がヘルプにも画面にも存在する', (label) => {
    expect(helpText, `ヘルプに「${label}」がありません`).toContain(label);
    expect(uiSource, `画面に「${label}」がありません`).toContain(label);
  });

  it('存在しない機能の名前が書かれていない', () => {
    ['自動送信', 'メール通知', 'クラウド保存', 'ログイン', 'AIが', '音声入力']
      .forEach((w) => expect(helpText, `${w} は実装されていません`).not.toContain(w));
  });
});

describe('HELP-03 書きぶり', () => {
  it('安全を断定する表現を使っていない', () => {
    ['安全です', '完全に保護', '絶対に漏れ', '100%', '心配ありません', '保証します']
      .forEach((w) => expect(helpText).not.toContain(w));
  });

  it('内部用語をそのまま出していない', () => {
    ['READY', 'STALE', 'OUTDATED', 'freshness', 'fingerprint', 'localStorage', 'API キー未設定']
      .forEach((w) => expect(helpText).not.toContain(w));
  });

  it('個人情報の注意に、持ち出しの具体例が入っている', () => {
    const privacy = findSection('privacy')!;
    const text = JSON.stringify(privacy);
    ['バックアップファイル', '印刷', 'スクリーンショット', 'USB', 'メール'].forEach((w) => {
      expect(text).toContain(w);
    });
  });

  it('「作り直しが必要」の原因と対応が書かれている', () => {
    const s = findSection('rebuild')!;
    const text = JSON.stringify(s);
    ['削除', '無効にする', '住所', '希望時間', '車両', '出発時刻', '前の日'].forEach((w) => {
      expect(text).toContain(w);
    });
    expect(text).toContain('もう一度');
  });

  it('支援記録に「入力されていないことは書かない」旨がある', () => {
    const s = findSection('support')!;
    const text = JSON.stringify(s);
    expect(text).toContain('入力していないことは文章になりません');
    expect(text).toContain('職員が確認');
  });

  it('バックアップに要配慮情報の扱いが書かれている', () => {
    const s = findSection('backup')!;
    const text = JSON.stringify(s);
    expect(text).toContain('既定では、支援記録・モニタリング記録は含まれません');
    expect(text).toContain('配慮が必要');
  });

  it('おすすめと最遅の違いが説明されている', () => {
    const s = findSection('route-result')!;
    const text = JSON.stringify(s);
    expect(text).toContain('おすすめ');
    expect(text).toContain('最遅');
    expect(text).toContain('推定値');
    expect(text).toContain('デモモード');
  });
});

describe('HELP-04 画面からの導線', () => {
  it('主要画面にヘルプへのリンクが置かれている', () => {
    ['Dashboard', 'Members', 'RouteCreate', 'RouteResult', 'SupportRecord', 'FacilitySettings']
      .forEach((page) => {
        const src = readFileSync(join(process.cwd(), 'src', 'pages', `${page}.tsx`), 'utf8');
        expect(src, `${page} にヘルプ導線がありません`).toContain('HelpLink');
      });
  });

  it('ヘルプ画面がルーティングに登録されている', () => {
    const app = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
    expect(app).toContain('path="/help"');
    expect(app).toContain('<Help />');
  });

  it('ヘルプ画面から外部通信を行っていない', () => {
    ['Help.tsx', 'HelpLink.tsx', 'FirstRunGuide.tsx'].forEach((f) => {
      const dir = f === 'Help.tsx' ? 'pages' : 'components';
      const src = readFileSync(join(process.cwd(), 'src', dir, f), 'utf8');
      ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'axios'].forEach((w) => {
        expect(src, `${f} に ${w} が含まれています`).not.toContain(w);
      });
    });
    const content = readFileSync(join(process.cwd(), 'src', 'lib', 'helpContent.ts'), 'utf8');
    expect(content).not.toContain('fetch(');
  });
});
