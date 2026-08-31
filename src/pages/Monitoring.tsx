/**
 * 月次モニタリング（/monitoring/:memberId）。
 *
 * ・その年の1月〜12月を、月ごとに独立して記録する
 * ・目標は期間つきの履歴で持ち、記録時点の目標を写して保存する
 *   （あとから目標を変えても、過去の月の記録は変わらない）
 * ・Excelは添付の原本様式どおり、月ごとのシートで出力する
 * ・外部通信は行わない
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { newMonthlyId, useAppStore } from '../store/useAppStore';
import GoalTermsEditor from '../components/GoalTermsEditor';
import HelpLink from '../components/HelpLink';
import { HELP_ANCHORS } from '../lib/helpContent';
import {
  ACHIEVEMENT_OPTIONS, DIRECTION_OPTIONS, IMPLEMENTATION_OPTIONS, SATISFACTION_OPTIONS,
} from '../lib/monitoringOptions';
import {
  DEFAULT_ASSESSMENT, MONTHS, availableYears, carryOverAssessments, findMonthly,
  goalForMonth, isEmptyMonthly, lastDayOfMonth, monitorNameSuggestions, monthLabel,
  monthsWithData, periodFromGoal, previousMonthlyRecord,
} from '../lib/monitoringYear';
import { buildMonitoringYearWorkbook } from '../lib/monitoringWorkbook';
import type { MonitoringGoalAssessment, MonitoringMonthlyRecord } from '../types';

const emptyAssessment = (): MonitoringGoalAssessment => ({});

export default function Monitoring() {
  const { memberId = '' } = useParams();
  const navigate = useNavigate();
  const {
    members, facility, monitoringGoalTerms, monitoringMonthly,
    saveMonthly,
  } = useAppStore();

  const member = members.find((m) => m.id === memberId);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [draft, setDraft] = useState<MonitoringMonthlyRecord | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const years = useMemo(
    () => availableYears(monitoringMonthly, memberId, today),
    [monitoringMonthly, memberId] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const filledMonths = useMemo(
    () => monthsWithData(monitoringMonthly, memberId, year),
    [monitoringMonthly, memberId, year]
  );
  const monitorCandidates = useMemo(
    () => monitorNameSuggestions(monitoringMonthly),
    [monitoringMonthly]
  );

  const longGoal = goalForMonth(monitoringGoalTerms, memberId, 'long', year, month);
  const shortGoal = goalForMonth(monitoringGoalTerms, memberId, 'short', year, month);

  // 月・年を切り替えたら、その月の記録を読み込む（無ければ新しい下書き）
  useEffect(() => {
    const existing = findMonthly(monitoringMonthly, memberId, year, month);
    if (existing) {
      setDraft({ ...existing });
    } else {
      setDraft({
        monthlyId: newMonthlyId(),
        memberId, year, month,
        // 実施日は、その月の末日を初期値にする
        implementedOn: lastDayOfMonth(year, month),
        monitorName: monitorCandidates[0] ?? '',
        // 期間は上部で登録した目標から引用し、評価はよく使う組み合わせを初期選択にする
        longTerm: { ...emptyAssessment(), ...DEFAULT_ASSESSMENT, ...periodFromGoal(longGoal) },
        shortTerm: { ...emptyAssessment(), ...DEFAULT_ASSESSMENT, ...periodFromGoal(shortGoal) },
        longGoalText: longGoal?.text ?? '', shortGoalText: shortGoal?.text ?? '',
        longGoalTermId: longGoal?.goalTermId, shortGoalTermId: shortGoal?.goalTermId,
        createdAt: '', updatedAt: '',
      });
    }
    setDirty(false);
    setSavedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, year, month, monitoringMonthly.length]);

  if (!member) {
    return (
      <div className="card text-center space-y-4">
        <p className="text-xl">この利用者は見つかりませんでした。</p>
        <Link to="/members" className="btn-primary">利用者管理へ戻る</Link>
      </div>
    );
  }
  if (!draft) return null;

  const patch = (p: Partial<MonitoringMonthlyRecord>) => {
    setDraft((d) => (d ? { ...d, ...p } : d));
    setDirty(true);
    setSavedAt(null);
  };
  const patchGoal = (key: 'longTerm' | 'shortTerm', p: Partial<MonitoringGoalAssessment>) => {
    setDraft((d) => (d ? { ...d, [key]: { ...(d[key] ?? {}), ...p } } : d));
    setDirty(true);
    setSavedAt(null);
  };

  /** 上部の目標の期間を、この月の期間欄へ入れ直す */
  const applyGoalPeriod = (key: 'longTerm' | 'shortTerm') => {
    const term = key === 'longTerm' ? longGoal : shortGoal;
    if (!term) {
      alert('先に上の「目標」を登録してください。');
      return;
    }
    patchGoal(key, periodFromGoal(term));
  };

  /** 前回の月の評価欄を引用する（実施日・目標本文は引き継がない） */
  const prevRecord = previousMonthlyRecord(monitoringMonthly, memberId, year, month);
  const applyPrevious = () => {
    if (!prevRecord) return;
    const label = `${prevRecord.year}年${prevRecord.month}月`;
    if (!confirm(`${label}の内容を引用します。いまの入力は上書きされます。よろしいですか？`)) return;
    const carried = carryOverAssessments(prevRecord);
    setDraft((d) => (d ? {
      ...d,
      longTerm: { ...carried.longTerm },
      shortTerm: { ...carried.shortTerm },
      monitorName: d.monitorName || prevRecord.monitorName || '',
    } : d));
    setDirty(true);
    setSavedAt(null);
  };

  const save = () => {
    const now = new Date().toISOString();
    saveMonthly({
      ...draft,
      // 記録した時点の目標を写して保存する（あとで目標を変えても過去は変わらない）
      longGoalText: draft.longGoalText || longGoal?.text || '',
      shortGoalText: draft.shortGoalText || shortGoal?.text || '',
      longGoalTermId: draft.longGoalTermId ?? longGoal?.goalTermId,
      shortGoalTermId: draft.shortGoalTermId ?? shortGoal?.goalTermId,
      createdAt: draft.createdAt || now,
      updatedAt: now,
    });
    setDirty(false);
    setSavedAt(new Date().toLocaleTimeString('ja-JP'));
  };

  const exportExcel = async () => {
    const ok = confirm(
      'このファイルには利用者の個人情報・支援情報が含まれます。\n' +
      '保存先や共有先を確認してください。\n\n' +
      `${year}年の1月〜12月を出力します。よろしいですか？`
    );
    if (!ok) return;
    setBusy(true);
    try {
      const records = new Map<number, MonitoringMonthlyRecord | null>();
      MONTHS.forEach((m) => records.set(m, findMonthly(monitoringMonthly, memberId, year, m)));
      const { wb, fileName } = await buildMonitoringYearWorkbook({
        memberName: member.name, officeName: facility.name, year, records,
      });
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName; a.click();
      URL.revokeObjectURL(url);
      alert(`出力しました：${fileName}`);
    } catch (e) {
      alert('出力できませんでした：' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /* ---------------- 目標の編集 ---------------- */

  /* ---------------- 月の評価欄 ---------------- */

  const assessmentEditor = (key: 'longTerm' | 'shortTerm', label: string) => {
    const a = draft[key] ?? {};
    const sel = (
      title: string, options: readonly string[], value: string | undefined,
      onChange: (v: string | undefined) => void
    ) => (
      <div>
        <label className="label">{title}</label>
        <select className="field" value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">未選択</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
    return (
      <div className="rounded-2xl border-2 border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h4 className="text-lg sm:text-xl font-bold">{label}</h4>
          <button className="btn-sub btn-sm sm:ml-auto" onClick={() => applyGoalPeriod(key)}>
            目標の期間を入れる
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">期間（開始）</label>
            <input className="field" type="date" value={a.periodFrom ?? ''}
              onChange={(e) => patchGoal(key, { periodFrom: e.target.value })} />
          </div>
          <div>
            <label className="label">期間（終了）</label>
            <input className="field" type="date" value={a.periodTo ?? ''}
              onChange={(e) => patchGoal(key, { periodTo: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {sel('実施状況', IMPLEMENTATION_OPTIONS, a.implementation,
            (v) => patchGoal(key, { implementation: v as MonitoringGoalAssessment['implementation'] }))}
          {sel('目標達成度', ACHIEVEMENT_OPTIONS, a.achievement,
            (v) => patchGoal(key, { achievement: v as MonitoringGoalAssessment['achievement'] }))}
          {sel('本人満足度', SATISFACTION_OPTIONS, a.satisfaction,
            (v) => patchGoal(key, { satisfaction: v as MonitoringGoalAssessment['satisfaction'] }))}
        </div>
        {sel('今後の方向性', DIRECTION_OPTIONS, a.direction,
          (v) => patchGoal(key, { direction: v as MonitoringGoalAssessment['direction'] }))}
        <div>
          <label className="label">具体的な理由等</label>
          <textarea className="field min-h-[4rem]" value={a.reason ?? ''}
            onChange={(e) => patchGoal(key, { reason: e.target.value })} />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* 見出し */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-gray-500 text-lg">モニタリング</p>
            <h2 className="text-2xl sm:text-3xl font-bold">{member.name}さん</h2>
            {member.kana && <p className="text-gray-500">{member.kana}</p>}
          </div>
          <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap items-center gap-2">
            <HelpLink anchor={HELP_ANCHORS.monitoring} />
            <button className="btn-sub btn-sm" onClick={() => navigate('/members')}>
              利用者管理へ戻る
            </button>
            <Link to={`/support/${member.id}`} className="btn-sub btn-sm">支援記録へ</Link>
          </div>
        </div>
      </div>

      {/* 目標 */}
      <div className="card space-y-4">
        <h3 className="text-xl sm:text-2xl font-bold">目標（期間ごとに管理します）</h3>
        <p className="text-gray-500">
          期間の途中で目標が変わった場合は、新しい目標を追加してください。
          過去に保存した月の記録は、当時の目標のまま残ります。
        </p>
        <GoalTermsEditor memberId={memberId} kind="long" label="長期目標"
          month={month} current={longGoal} />
        <GoalTermsEditor memberId={memberId} kind="short" label="短期目標"
          month={month} current={shortGoal} />
      </div>

      {/* 年と月の切り替え */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-xl sm:text-2xl font-bold">記録する月</h3>
          <select className="field w-auto sm:ml-auto" value={year}
            onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}年</option>)}
          </select>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {MONTHS.map((m) => {
            const has = filledMonths.includes(m);
            const on = m === month;
            return (
              <button key={m} onClick={() => setMonth(m)}
                className={
                  'rounded-xl px-2 py-3 text-base sm:text-lg font-bold border-2 ' +
                  (on
                    ? 'bg-accent text-white border-accent'
                    : has
                    ? 'bg-accentSoft text-accent border-accent'
                    : 'bg-white text-ink border-gray-300 hover:bg-gray-50')
                }>
                {monthLabel(m)}
                {has && !on && <span className="block text-xs">記録あり</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* 月の入力 */}
      <div className="card space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-xl sm:text-2xl font-bold">
            {year}年{monthLabel(month)}のモニタリング
          </h3>
          <span className={
            'badge sm:ml-auto ' +
            (dirty ? 'bg-warnSoft text-warn' : savedAt ? 'bg-accentSoft text-accent' : 'bg-gray-100 text-gray-600')
          }>
            {dirty ? '未保存の変更があります' : savedAt ? `保存しました（${savedAt}）` : '変更なし'}
          </span>
        </div>

        {prevRecord && (
          <div className="rounded-2xl border-2 border-gray-200 p-3 flex flex-wrap items-center gap-3">
            <p className="text-base sm:text-lg">
              前回の記録：{prevRecord.year}年{prevRecord.month}月
              {prevRecord.monitorName && `（${prevRecord.monitorName}）`}
            </p>
            <button className="btn-sub btn-sm sm:ml-auto" onClick={applyPrevious}>
              前回の内容を引用する
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">モニタリング実施日</label>
            <input className="field" type="date" value={draft.implementedOn ?? ''}
              onChange={(e) => patch({ implementedOn: e.target.value })} />
          </div>
          <div>
            <label className="label">モニタリング実施者</label>
            <input className="field" list="monitor-candidates" placeholder="担当職員名"
              value={draft.monitorName ?? ''}
              onChange={(e) => patch({ monitorName: e.target.value })} />
            <datalist id="monitor-candidates">
              {monitorCandidates.map((n) => <option key={n} value={n} />)}
            </datalist>
            {monitorCandidates.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {monitorCandidates.slice(0, 4).map((n) => (
                  <button key={n} className="btn-sub btn-sm"
                    onClick={() => patch({ monitorName: n })}>{n}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        {assessmentEditor('longTerm', '長期目標について')}
        {assessmentEditor('shortTerm', '短期目標について')}

        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" onClick={save}>この月の記録を保存する</button>
          <button className="btn-sub" onClick={exportExcel} disabled={busy}>
            {busy ? '出力中…' : `${year}年をExcelで出力`}
          </button>
        </div>
        {isEmptyMonthly(draft) && !dirty && (
          <p className="text-gray-500">この月はまだ何も入力されていません。</p>
        )}
      </div>

      <div className="card">
        <p className="text-gray-600">
          モニタリングの内容は、利用者の氏名とともに<strong>この端末のブラウザ内にのみ保存</strong>されます。
          外部のサービスへ送信されることはありません（Excelの作成もこの端末の中で行っています）。
        </p>
      </div>
    </div>
  );
}
