/**
 * 各画面から、その画面の説明へ飛ぶボタン。
 * 画面の見出しの右側に置く想定。スマートフォンでも押せる大きさにしている。
 */
import { Link } from 'react-router-dom';

export default function HelpLink({ anchor, label = 'ヘルプ' }: { anchor: string; label?: string }) {
  return (
    <Link
      to={`/help#${anchor}`}
      className="no-print inline-flex items-center gap-1 rounded-xl border-2 border-gray-500
                 bg-white px-3 py-2 text-base font-bold text-ink hover:bg-gray-100 active:bg-gray-200"
      title="この画面の使い方を見る"
    >
      <span aria-hidden="true">？</span>
      <span>{label}</span>
    </Link>
  );
}
