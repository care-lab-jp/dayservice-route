/**
 * モニタリング記録の入力・作成パネル（支援記録画面の中で使う）。
 *
 * ・外部通信なし。文章づくりも Excel 生成もこの端末の中で完結する
 * ・期間・目標・評価は職員が入力したものだけを使う（アプリは推測しない）
 * ・既存の支援記録からの反映は「自動確定」ではなく、必ず確認・編集できる
 */
import { useMemo, useState } from 'react';
import { newMonitoringId, useAppStore } from '../store/useAppStore';
import { buildMonitoringText, displayMonitoringText, periodLabel } from '../lib/monitoringText';
import {
  copyForNewRecord, findOverlapping, historySummary, overlapWarningMessage,
  sortByPeriodDesc, validatePeriod,
} from '../lib/monitoringRules';
import { requestMonitoringExcelExport } from '../lib/monitoringExcel';
import { displayTextOf } from '../lib/supportText';
import { findItem } from '../lib/supportCatalog';
import type { GoalEvaluation, Member, MonitoringRecord, SupportMeasures } from '../types';

const EVALUATIONS: GoalEvaluation[] = [
  '達成', '概ね達成', '一部達成', '未達成', '継続して支援', '評価困難',
];

const emptyDraft = (memberId: string): MonitoringRecord => ({
  monitoringRecordId: '',
  memberId,
  createdAt: '',
  updatedAt: '',
  periodFrom: '',
  periodTo: '',
  longTermGoal: '',
  shortTermGoal: '',
  checkedItems: [],
  generatedText: '',
});

export default function MonitoringPanel({ member }: { member: Member }) {
  const {
    supportRecordsOf, monitoringRecords: allMonitoringRecords,
    addMonitoringRecord, updateMonitoringRecord, removeMonitoringRecord,
  } = useAppStore();

  const supportRecords = supportRecordsOf(member.id);
  const records = useMemo(
    () => sortByPeriodDesc(allMonitoringRecords.filter((r) => r.memberId === member.id)),
    [allMonitoringRecords, member.id]
  );

  const [draft, setDraft] = useState<MonitoringRecord>(() => emptyDraft(member.id));
  const [text, setText] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reflected, setReflected] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);

  const patch = (p: Partial<MonitoringRecord>) => {
    setDraft((d) => ({ ...d, ...p }));
    setCopied(false);
  };

  /** 過去のモニタリング記録に出てくる目標を候補として集める（重複を除く） */
  const goalSuggestions = useMemo(() => {
    const long = new Set<string>();
    const short = new Set<string>();
    records.forEach((r) => {
      if (r.longTermGoal?.trim()) long.add(r.longTermGoal.trim());
      if (r.shortTermGoal?.trim()) short.add(r.shortTermGoal.trim());
    });
    return { long: [...long].slice(0, 5), short: [...short].slice(0, 5) };
  }, [records]);

  /** 支援記録から反映（自動確定ではなく、下書きに入れるだけ） */
  const reflectFrom = (recordId: string) => {
    const r = supportRecords.find((x) => x.recordId === recordId);
    if (!r) return;
    patch({
      sourceSupportRecordId: r.recordId,
      checkedItems: [...(r.checkedItems ?? [])],
      baseline: r.baseline ? ({ ...r.baseline } as SupportMeasures) : undefined,
      current: r.current ? ({ ...r.current } as SupportMeasures) : undefined,
    });
    setReflected(true);
  };

  /** 前回のモニタリング期間をコピー（次の期間の入力を楽にする） */
  const copyPreviousPeriod = () => {
    const prev = records[0];
    if (!prev) return;
    patch({ periodFrom: prev.periodFrom, periodTo: prev.periodTo });
  };

  const build = () => {
    setText(buildMonitoringText(draft).text);
    setCopied(false);
  };

  const save = () => {
    if (!text) return;

    // 期間が不正なら保存しない
    const v = validatePeriod(draft.periodFrom, draft.periodTo);
    if (!v.ok) { alert(v.error); return; }

    // 期間が重なる記録があれば警告（保存自体は止めない）
    const overlaps = findOverlapping(
      allMonitoringRecords, member.id, draft.periodFrom, draft.periodTo, editingId ?? undefined
    );
    if (overlaps.length > 0 && !confirm(overlapWarningMessage(overlaps))) return;

    const now = new Date().toISOString();
    if (editingId) {
      updateMonitoringRecord(editingId, { ...draft, editedText: text });
    } else {
      const rec: MonitoringRecord = {
        ...draft,
        monitoringRecordId: newMonitoringId(),
        memberId: member.id,
        createdAt: now,
        updatedAt: now,
        generatedText: text,
      };
      addMonitoringRecord(rec);
      setEditingId(rec.monitoringRecordId);
      setDraft(rec);
    }
  };

  const load = (r: MonitoringRecord) => {
    setDraft({ ...r });
    setText(displayMonitoringText(r));
    setEditingId(r.monitoringRecordId);
    setReflected(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const startNew = () => {
    setDraft(emptyDraft(member.id));
    setText(null);
    setEditingId(null);
    setReflected(false);
    setCopiedFrom(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** 前回の記録を複製して新しい記録の下書きにする（元の記録は変更しない） */
  const copyFromPrevious = (r: MonitoringRecord) => {
    setDraft(copyForNewRecord(r, member.id));
    setText(null);
    setEditingId(null);
    setReflected(false);
    setCopiedFrom(periodLabel(r));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Excel出力（確認は requestMonitoringExcelExport の中で必ず行われる） */
  const exportExcel = async (r: MonitoringRecord) => {
    try {
      const name = await requestMonitoringExcelExport(r, member.name);
      if (name) alert(`出力しました：${name}`);
    } catch (e) {
      alert('出力できませんでした：' + (e as Error).message);
    }
  };

  const checkedLabels = (draft.checkedItems ?? [])
    .map((id) => findItem(id)?.label)
    .filter(Boolean) as string[];

  const evalRow = (
    label: string,
    value: GoalEvaluation | undefined,
    onEval: (v: GoalEvaluation | undefined) => void,
    comment: string,
    onComment: (v: string) => void
  ) => (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
        <span className="text-base sm:text-lg font-bold text-gray-700">{label}</span>
        <select className="field sm:col-span-2" value={value ?? ''}
          onChange={(e) => onEval((e.target.value || undefined) as GoalEvaluation | undefined)}>
          <option value="">未選択</option>
          {EVALUATIONS.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <textarea className="field min-h-[4rem]" placeholder="評価コメント（任意）"
        value={comment} onChange={(e) => onComment(e.target.value)} />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* いま何を編集しているか */}
      <div className="card flex flex-wrap items-center gap-3">
        <div>
          <p className="text-gray-500 text-lg">作成中のモニタリング</p>
          <p className="text-xl font-bold">
            {editingId
              ? `保存済みの記録を編集中（${periodLabel(draft)}）`
              : '新しい記録を作成中'}
          </p>
        </div>
        <button className="btn-sub w-full sm:w-auto sm:ml-auto" onClick={startNew}>
          ＋ 新しいモニタリングを作成
        </button>
      </div>

      {copiedFrom && !editingId && (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4">
          <p className="text-lg font-bold">前回の記録（{copiedFrom}）の内容をコピーしています。</p>
          <p>期間と評価は必ず入力・確認し直してから保存してください。前回の記録は変更されていません。</p>
        </div>
      )}

      {/* 支援記録からの反映 */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-xl sm:text-2xl font-bold">支援記録からの反映</h3>
        </div>
        {supportRecords.length === 0 ? (
          <p className="text-gray-500 text-lg">
            この利用者の支援記録はまだありません。「支援記録」タブで先に作成すると、
            現在の状態・支援内容・本人の希望をここへ反映できます。
          </p>
        ) : (
          <>
            <p className="text-gray-600">
              反映したい支援記録を選んでください（内容は下で確認・編集できます）。
            </p>
            <div className="space-y-2">
              {supportRecords.slice(0, 5).map((r) => (
                <div key={r.recordId} className="rounded-2xl border-2 border-gray-200 p-3 flex flex-wrap gap-2 items-center">
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-500">{new Date(r.createdAt).toLocaleString('ja-JP')}</p>
                    <p className="text-base line-clamp-2">{displayTextOf(r).split('\n')[0]}</p>
                  </div>
                  <button className="btn-sub btn-sm w-full sm:w-auto" onClick={() => reflectFrom(r.recordId)}>
                    この記録から反映
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        {reflected && (
          <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4">
            <p className="text-lg font-bold">既存の支援記録から反映しています。</p>
            <p>内容を確認してから保存してください。</p>
          </div>
        )}
        {checkedLabels.length > 0 && (
          <div>
            <p className="label">反映されている項目</p>
            <div className="flex flex-wrap gap-2">
              {checkedLabels.map((l) => (
                <span key={l} className="badge bg-accentSoft text-accent">{l}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 期間 */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-xl sm:text-2xl font-bold">モニタリング期間</h3>
          {records.length > 0 && (
            <button className="btn-sub btn-sm sm:ml-auto" onClick={copyPreviousPeriod}>
              前回期間をコピー
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">開始日</label>
            <input className="field" type="date" value={draft.periodFrom}
              onChange={(e) => patch({ periodFrom: e.target.value })} />
          </div>
          <div>
            <label className="label">終了日</label>
            <input className="field" type="date" value={draft.periodTo}
              onChange={(e) => patch({ periodTo: e.target.value })} />
          </div>
        </div>
      </div>

      {/* 目標 */}
      <div className="card space-y-4">
        <h3 className="text-xl sm:text-2xl font-bold">目標</h3>
        <div>
          <label className="label">長期目標</label>
          <textarea className="field min-h-[5rem]"
            placeholder="例：住み慣れた自宅で安全に生活を継続する"
            value={draft.longTermGoal} onChange={(e) => patch({ longTermGoal: e.target.value })} />
          {goalSuggestions.long.length > 0 && (
            <div className="mt-2">
              <p className="text-gray-500">過去のモニタリングで使った長期目標：</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {goalSuggestions.long.map((g) => (
                  <button key={g} className="btn-sub btn-sm" onClick={() => patch({ longTermGoal: g })}>
                    {g.length > 24 ? g.slice(0, 24) + '…' : g}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div>
          <label className="label">短期目標</label>
          <textarea className="field min-h-[5rem]"
            placeholder="例：屋内での歩行を安定させ、トイレまで安全に移動できる"
            value={draft.shortTermGoal} onChange={(e) => patch({ shortTermGoal: e.target.value })} />
          {goalSuggestions.short.length > 0 && (
            <div className="mt-2">
              <p className="text-gray-500">過去のモニタリングで使った短期目標：</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {goalSuggestions.short.map((g) => (
                  <button key={g} className="btn-sub btn-sm" onClick={() => patch({ shortTermGoal: g })}>
                    {g.length > 24 ? g.slice(0, 24) + '…' : g}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 評価 */}
      <div className="card space-y-5">
        <h3 className="text-xl sm:text-2xl font-bold">目標に対する評価</h3>
        <p className="text-gray-500">
          評価は職員が選択します。アプリが達成・未達成を判断することはありません。
        </p>
        {evalRow('長期目標', draft.longTermEvaluation,
          (v) => patch({ longTermEvaluation: v }),
          draft.longTermComment ?? '', (v) => patch({ longTermComment: v }))}
        {evalRow('短期目標', draft.shortTermEvaluation,
          (v) => patch({ shortTermEvaluation: v }),
          draft.shortTermComment ?? '', (v) => patch({ shortTermComment: v }))}
      </div>

      {/* 方針・総合コメント */}
      <div className="card space-y-4">
        <h3 className="text-xl sm:text-2xl font-bold">今後の支援方針・総合コメント</h3>
        <div>
          <label className="label">今後の支援方針（任意）</label>
          <textarea className="field min-h-[4rem]"
            placeholder="未入力の場合は、入力内容に応じた定型文が入ります"
            value={draft.policy ?? ''} onChange={(e) => patch({ policy: e.target.value })} />
        </div>
        <div>
          <label className="label">モニタリング総合コメント（任意・Excelに出力されます）</label>
          <textarea className="field min-h-[4rem]"
            value={draft.overallComment ?? ''} onChange={(e) => patch({ overallComment: e.target.value })} />
        </div>
      </div>

      <button className="btn-primary w-full text-xl sm:text-2xl py-5 sm:py-6" onClick={build}>
        モニタリング文章を作成する
      </button>

      {/* 生成結果 */}
      {text !== null && (
        <div className="card space-y-3">
          <h3 className="text-xl sm:text-2xl font-bold">作成した文章</h3>
          <textarea className="field min-h-[14rem] leading-relaxed" value={text}
            onChange={(e) => { setText(e.target.value); setCopied(false); }} />
          <p className="text-gray-600">
            ※入力された情報をもとに自動生成した文章です。内容を確認・修正してから記録してください。
          </p>
          <div className="flex flex-wrap gap-3">
            <button className="btn-sub" onClick={async () => {
              try { await navigator.clipboard.writeText(text); setCopied(true); }
              catch { alert('コピーできませんでした。文章を選択して手動でコピーしてください。'); }
            }}>{copied ? 'コピーしました' : 'コピー'}</button>
            <button className="btn-primary" onClick={save}>
              {editingId ? '上書き保存する' : '保存する'}
            </button>
            {editingId && (
              <button className="btn-sub" onClick={() => exportExcel({ ...draft, editedText: text })}>
                Excelで出力
              </button>
            )}
          </div>
          {!editingId && (
            <p className="text-gray-500">Excel出力は、保存したあとに行えます。</p>
          )}
        </div>
      )}

      {/* モニタリング履歴 */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h3 className="text-xl sm:text-2xl font-bold">
            モニタリング履歴（{records.length}件）
          </h3>
          <button className="btn-sub btn-sm w-full sm:w-auto sm:ml-auto" onClick={startNew}>
            ＋ 新しいモニタリングを作成
          </button>
        </div>
        {records.length === 0 ? (
          <p className="text-gray-500 text-lg">まだ保存された記録はありません。</p>
        ) : (
          <ul className="space-y-3">
            {records.map((r) => {
              const sum = historySummary(r);
              return (
                <li key={r.monitoringRecordId}
                  className={
                    'rounded-2xl border-2 p-4 ' +
                    (r.monitoringRecordId === editingId ? 'border-accent bg-accentSoft' : 'border-gray-200')
                  }>
                  <p className="text-lg sm:text-xl font-bold">{sum.period}</p>
                  <p className="text-gray-600">評価：{sum.evaluation}</p>
                  <p className="text-gray-500">更新日：{sum.updatedAt}</p>
                  <p className="text-base whitespace-pre-line mt-2 line-clamp-3">
                    {displayMonitoringText(r)}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button className="btn-sub btn-sm" onClick={() => load(r)}>開く</button>
                    <button className="btn-sub btn-sm" onClick={() => exportExcel(r)}>Excel</button>
                    <button className="btn-sub btn-sm" onClick={() => copyFromPrevious(r)}>
                      この内容をコピーして新規作成
                    </button>
                    <button className="btn-danger btn-sm" onClick={() => {
                      if (confirm(`${sum.period} のモニタリング記録を削除します。元に戻せません。よろしいですか？`)) {
                        removeMonitoringRecord(r.monitoringRecordId);
                        if (editingId === r.monitoringRecordId) startNew();
                      }
                    }}>削除</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
