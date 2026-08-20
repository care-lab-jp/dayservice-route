/**
 * 使い方・ヘルプ。
 * 本文は lib/helpContent.ts のデータをそのまま表示するだけで、外部通信は行わない。
 * 各画面の「？ヘルプ」からは /help#<id> で該当箇所へ移動する。
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { HELP_SECTIONS, type HelpBlock } from '../lib/helpContent';

function Block({ block }: { block: HelpBlock }) {
  if (block.kind === 'text') {
    return <p className="text-base sm:text-lg leading-relaxed">{block.text}</p>;
  }
  if (block.kind === 'steps') {
    return (
      <ol className="space-y-2">
        {block.items.map((t, i) => (
          <li key={i} className="flex gap-3">
            <span className="w-8 h-8 shrink-0 rounded-full bg-accent text-white grid place-items-center font-bold">
              {i + 1}
            </span>
            <span className="text-base sm:text-lg leading-relaxed pt-1">{t}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (block.kind === 'list') {
    return (
      <ul className="list-disc pl-6 space-y-1">
        {block.items.map((t, i) => (
          <li key={i} className="text-base sm:text-lg leading-relaxed">{t}</li>
        ))}
      </ul>
    );
  }
  // note
  const warn = block.tone === 'warn';
  return (
    <div className={
      'rounded-2xl border-2 p-4 ' +
      (warn ? 'border-warn bg-warnSoft' : 'border-accent bg-accentSoft')
    }>
      <p className={'text-lg font-bold ' + (warn ? 'text-warn' : '')}>
        {warn ? '⚠ ' : '✓ '}{block.title}
      </p>
      <ul className="list-disc pl-6 mt-2 space-y-1">
        {block.items.map((t, i) => (
          <li key={i} className="text-base sm:text-lg leading-relaxed">{t}</li>
        ))}
      </ul>
    </div>
  );
}

export default function Help() {
  const location = useLocation();

  // /help#members のように指定された箇所へ移動する
  useEffect(() => {
    const id = location.hash.replace('#', '');
    if (!id) {
      window.scrollTo({ top: 0 });
      return;
    }
    // 描画後に位置が確定するため、次のフレームで探す
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [location.hash, location.key]);

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="text-2xl sm:text-3xl font-bold">使い方・ヘルプ</h2>
        <p className="text-gray-600 mt-2">
          知りたいところだけ読めます。困ったときは、各画面の右上にある「？ヘルプ」から
          その画面の説明に飛べます。
        </p>
      </div>

      {/* 目次 */}
      <div className="card">
        <h3 className="text-xl sm:text-2xl font-bold mb-3">目次</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {HELP_SECTIONS.map((s) => (
            <button key={s.id} onClick={() => jump(s.id)}
              className="text-left rounded-2xl border-2 border-gray-200 bg-white p-3 hover:bg-gray-50">
              <span className="text-lg font-bold">{s.title}</span>
              <span className="block text-gray-500">{s.summary}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 本文 */}
      {HELP_SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="card space-y-4 scroll-mt-4">
          <div>
            <h3 className="text-xl sm:text-2xl font-bold">{s.title}</h3>
            <p className="text-gray-500">{s.summary}</p>
          </div>
          {s.blocks.map((b, i) => <Block key={i} block={b} />)}
          <div className="pt-2">
            <button className="btn-sub btn-sm" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              目次に戻る
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
