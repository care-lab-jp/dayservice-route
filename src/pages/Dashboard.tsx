import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { todayLabel, toHHMM } from '../lib/time';
import { planFreshness } from '../lib/freshness';
import HelpLink from '../components/HelpLink';
import FirstRunGuide from '../components/FirstRunGuide';
import { HELP_ANCHORS } from '../lib/helpContent';

export default function Dashboard() {
  const { facility, members, vehicles, selectedIds, dayPlan, departTime } = useAppStore();
  const fresh = planFreshness(dayPlan, { facility, members, vehicles, departTime });
  const routes = dayPlan?.routes ?? [];
  const stopCount = routes.reduce((a, r) => a + r.stops.length, 0);
  const first = routes[0] ?? null;
  const hasError = routes.some((r) => r.issues.some((i) => i.level === 'error'));
  const trafficDelay = routes.reduce((a, r) => a + (r.trafficDelayMin ?? 0), 0);
  const navigate = useNavigate();
  const activeMembers = members.filter((m) => m.active);
  const todayCount = selectedIds.filter((id) => activeMembers.some((m) => m.id === id)).length;

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-start gap-3">
        <div>
          <p className="text-gray-500 text-lg">{todayLabel()}</p>
          <h2 className="text-2xl sm:text-3xl font-bold mt-1">{facility.name}</h2>
        </div>
        <div className="ml-auto"><HelpLink anchor={HELP_ANCHORS.dashboard} /></div>
      </div>

      <FirstRunGuide />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="card text-center">
          <p className="text-gray-500 text-lg">今日の利用者</p>
          <p className="text-4xl sm:text-5xl font-bold mt-2">{todayCount}<span className="text-2xl">名</span></p>
        </div>
        <div className="card text-center">
          <p className="text-gray-500 text-lg">登録利用者</p>
          <p className="text-4xl sm:text-5xl font-bold mt-2">{activeMembers.length}<span className="text-2xl">名</span></p>
        </div>
        <div className="card text-center">
          <p className="text-gray-500 text-lg">出発予定</p>
          <p className="text-4xl sm:text-5xl font-bold mt-2">{departTime}</p>
          {first?.recommendedDepartMin != null && first.recommendedDepartReason !== 'ok' && (
            <p className={
              'mt-2 text-lg font-bold ' +
              (first.recommendedDepartReason === 'impossible' ? 'text-warn' : 'text-amber-700')
            }>
              {first.recommendedDepartReason === 'impossible'
                ? '時刻調整では間に合いません'
                : `おすすめ ${toHHMM(first.recommendedDepartMin)}`}
            </p>
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="text-2xl font-bold mb-4">今日の送迎</h3>
        {first && stopCount > 0 && fresh.status === 'OUTDATED' ? (
          <div className="space-y-2">
            <p className="text-warn text-xl font-bold">
              ⚠ 表示できる送迎表は {dayPlan?.date} に作成されたものです
            </p>
            <p className="text-lg text-gray-600">本日ぶんのルートはまだ作成されていません。</p>
          </div>
        ) : first && stopCount > 0 ? (
          <div className="space-y-2">
            <p className="text-lg">
              {toHHMM(first.departMin)} 出発 → {stopCount}件 → {toHHMM(first.returnMin)} 施設到着予定
              {routes.length > 1 && <span className="text-gray-500">（{routes.length}台）</span>}
            </p>
            {trafficDelay > 0 && (
              <p className="text-lg text-gray-600">交通状況により通常より約{trafficDelay}分増</p>
            )}
            {hasError && (
              <p className="text-warn font-bold text-lg">⚠ 時間制約を満たせない箇所があります</p>
            )}
            {fresh.status === 'STALE' && (
              <p className="text-warn font-bold text-lg">⚠ 登録内容が変更されています。作り直してください</p>
            )}
            <Link to="/result" className="btn-sub mt-2">ルート結果を見る</Link>
          </div>
        ) : (
          <p className="text-gray-500 text-lg">まだ本日のルートは作成されていません。</p>
        )}
      </div>

      <button className="btn-primary w-full text-2xl py-6" onClick={() => navigate('/create')}>
        ルートを作成する
      </button>
    </div>
  );
}
