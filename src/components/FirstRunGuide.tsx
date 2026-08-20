/**
 * 初回だけ表示する簡単な案内。
 * ・「閉じた」ことは端末に覚えるだけで、利用者データには保存しない
 * ・すでに利用者を登録している端末では最初から表示しない
 * ・外部通信は行わない
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { localStore } from '../lib/storage';
import { HELP_ANCHORS } from '../lib/helpContent';

const SEEN_KEY = 'dayservice-route/first-run-guide-done';

export default function FirstRunGuide() {
  const members = useAppStore((s) => s.members);
  const dayPlan = useAppStore((s) => s.dayPlan);

  const [dismissed, setDismissed] = useState(
    () => !!localStore.getItem(SEEN_KEY)
  );

  // すでに使い始めている端末では出さない
  const alreadyUsing = members.length > 0 || !!dayPlan;
  if (dismissed || alreadyUsing) return null;

  const close = () => {
    localStore.setItem(SEEN_KEY, new Date().toISOString());
    setDismissed(true);
  };

  return (
    <div className="card border-2 border-accent bg-accentSoft space-y-4 no-print">
      <h3 className="text-xl sm:text-2xl font-bold">送迎ルートを作ってみましょう</h3>
      <ol className="space-y-2">
        {[
          '「利用者管理」で利用者を登録します',
          '住所と、お迎え希望時間を確認します',
          '「送迎ルート作成」で「③ ルートを作成」を押します',
        ].map((t, i) => (
          <li key={i} className="flex gap-3">
            <span className="w-8 h-8 shrink-0 rounded-full bg-accent text-white grid place-items-center font-bold">
              {i + 1}
            </span>
            <span className="text-base sm:text-lg pt-1">{t}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3">
        <Link to={`/help#${HELP_ANCHORS.dashboard}`} className="btn-sub" onClick={close}>
          使い方を見る
        </Link>
        <Link to="/members" className="btn-primary" onClick={close}>
          はじめる
        </Link>
      </div>
    </div>
  );
}
