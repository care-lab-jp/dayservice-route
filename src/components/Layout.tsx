import { NavLink } from 'react-router-dom';
import { hasGoogleKey } from '../lib/travelProvider';
import { useApiStatus } from '../lib/apiStatus';
import { useTenantStore } from '../lib/tenant';
import { useSaveStatus } from '../lib/saveStatus';
import { todayLabel } from '../lib/time';

const tabs = [
  { to: '/', label: 'ダッシュボード' },
  { to: '/create', label: '送迎ルート作成' },
  { to: '/result', label: 'ルート結果' },
  { to: '/members', label: '利用者管理' },
  { to: '/facility', label: '施設設定' },
];

/** 保存に失敗したことを、消えない赤帯で知らせる（黙って失われるのを防ぐ） */
function SaveFailureBar() {
  const { failed, message, detail } = useSaveStatus();
  if (!failed) return null;
  return (
    <div className="no-print bg-warn text-white px-4 py-3">
      <div className="max-w-5xl mx-auto">
        <p className="text-lg font-bold">⚠ {message}</p>
        <p className="text-sm">
          入力した内容がこの端末に保存されていない可能性があります。
          「施設設定 → データの管理 → データを書き出す」でバックアップを取り、
          不要な過去ルートを減らすか、別の端末をお試しください。
        </p>
        {detail && (
          <details className="text-xs mt-1">
            <summary className="cursor-pointer">技術的な詳細</summary>
            <pre className="whitespace-pre-wrap break-all">{detail}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

function TenantChip() {
  const tenant = useTenantStore((s) => s.tenants.find((t) => t.id === s.currentId));
  if (!tenant) return null;
  return (
    <span className="badge bg-gray-100 text-gray-700" title="表示中の施設（データは施設ごとに分離）">
      {tenant.name}
    </span>
  );
}

function StatusBadge() {
  const { mode, lastError } = useApiStatus();
  if (!hasGoogleKey()) {
    return (
      <span className="badge bg-gray-100 text-gray-600" title="APIキー未設定のため推定値で計算します">
        デモモード（APIキー未設定）
      </span>
    );
  }
  if (mode === 'fallback') {
    return (
      <span className="badge bg-warnSoft text-warn" title={lastError?.hint}>
        ⚠ Google Maps 接続エラー → デモモードで継続
      </span>
    );
  }
  return <span className="badge bg-accentSoft text-accent">Google Maps 連携済み</span>;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full">
      <SaveFailureBar />
      <header className="no-print bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-2xl font-bold">送迎ルート作成</h1>
          <span className="text-gray-500 text-lg">{todayLabel()}</span>
          <TenantChip />
          <span className="ml-auto text-sm"><StatusBadge /></span>
        </div>
        <nav className="max-w-5xl mx-auto px-4 pb-3 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className={({ isActive }) =>
                'rounded-xl px-5 py-3 text-lg font-bold border ' +
                (isActive
                  ? 'bg-accent text-white border-accent'
                  : 'bg-white text-ink border-gray-300 hover:bg-gray-50')
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
