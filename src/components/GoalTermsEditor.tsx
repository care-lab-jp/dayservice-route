/**
 * 期間つきの目標（長期・短期）の登録・編集・削除。
 *
 * 画面の外に切り出しているのは、入力中に再描画で作り直されないようにするため
 * （中に定義していると、1文字打つたびに入力欄が作り直されて文字が飛ぶ）。
 */
import { useState } from 'react';
import { useAppStore, newGoalTermId } from '../store/useAppStore';
import { goalHistory, monthLabel, shortTermEndDate } from '../lib/monitoringYear';
import type { MonitoringGoalKind, MonitoringGoalTerm } from '../types';

interface Props {
  memberId: string;
  kind: MonitoringGoalKind;
  label: string;
  /** いま表示している月（この月に適用される目標を上に出す） */
  month: number;
  current: MonitoringGoalTerm | null;
}

export default function GoalTermsEditor({ memberId, kind, label, month, current }: Props) {
  const { monitoringGoalTerms, addGoalTerm, updateGoalTerm, removeGoalTerm } = useAppStore();
  const history = goalHistory(monitoringGoalTerms, memberId, kind);

  // 新規追加用
  const [text, setText] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  // 編集用（編集中の目標ID）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');

  const onStart = (v: string) => {
    setStart(v);
    // 短期目標は開始日から6か月間で終了日を自動計算（手で変更できる）
    if (kind === 'short' && v) setEnd(shortTermEndDate(v));
  };

  const add = () => {
    if (!text.trim()) { alert('目標の内容を入力してください。'); return; }
    if (!start) { alert('適用開始日を入力してください。'); return; }
    const now = new Date().toISOString();
    // 直前の目標の終了日が空なら、新しい目標の開始日の前日で締める
    const prev = history.find((t) => !t.endDate?.trim() && t.startDate < start);
    if (prev) {
      const d = new Date(start);
      d.setDate(d.getDate() - 1);
      updateGoalTerm(prev.goalTermId, { endDate: d.toISOString().slice(0, 10) });
    }
    addGoalTerm({
      goalTermId: newGoalTermId(), memberId, kind,
      text: text.trim(), startDate: start, endDate: end,
      createdAt: now, updatedAt: now,
    });
    setText(''); setStart(''); setEnd('');
  };

  const startEdit = (t: MonitoringGoalTerm) => {
    setEditingId(t.goalTermId);
    setEditText(t.text);
    setEditStart(t.startDate);
    setEditEnd(t.endDate ?? '');
  };

  const saveEdit = () => {
    if (!editingId) return;
    if (!editText.trim()) { alert('目標の内容を入力してください。'); return; }
    if (!editStart) { alert('適用開始日を入力してください。'); return; }
    if (editEnd && editStart > editEnd) {
      alert('適用開始日が終了日より後になっています。');
      return;
    }
    updateGoalTerm(editingId, {
      text: editText.trim(), startDate: editStart, endDate: editEnd,
    });
    setEditingId(null);
  };

  return (
    <div className="rounded-2xl border-2 border-gray-200 p-4 space-y-3">
      <h4 className="text-lg sm:text-xl font-bold">{label}</h4>

      <div className={'rounded-xl p-3 ' + (current ? 'bg-accentSoft' : 'bg-gray-100')}>
        <p className="text-gray-600">{monthLabel(month)}に適用される目標</p>
        <p className="text-lg font-bold whitespace-pre-line">{current?.text || '（未設定）'}</p>
        {current && (
          <p className="text-gray-500">
            {current.startDate}　〜　{current.endDate || '（終了日未定）'}
          </p>
        )}
      </div>

      <details>
        <summary className="cursor-pointer text-lg font-bold">
          目標を追加・変更する（履歴 {history.length}件）
        </summary>

        <div className="mt-3 space-y-3">
          {/* 新規追加 */}
          <div className="rounded-xl border-2 border-gray-200 p-3 space-y-3">
            <p className="font-bold">新しい目標を追加</p>
            <div>
              <label className="label">目標の内容</label>
              <textarea className="field min-h-[4rem]" value={text}
                onChange={(e) => setText(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">適用開始日</label>
                <input className="field" type="date" value={start}
                  onChange={(e) => onStart(e.target.value)} />
              </div>
              <div>
                <label className="label">
                  終了日{kind === 'short' && '（6か月で自動計算・変更可）'}
                </label>
                <input className="field" type="date" value={end}
                  onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>
            <button className="btn-primary" onClick={add}>この目標を追加する</button>
          </div>

          {/* 履歴（編集・削除） */}
          {history.length > 0 && (
            <ul className="space-y-2">
              {history.map((t) => (
                <li key={t.goalTermId} className="rounded-xl border-2 border-gray-200 p-3">
                  {editingId === t.goalTermId ? (
                    <div className="space-y-3">
                      <div>
                        <label className="label">目標の内容</label>
                        <textarea className="field min-h-[4rem]" value={editText}
                          onChange={(e) => setEditText(e.target.value)} />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="label">適用開始日</label>
                          <input className="field" type="date" value={editStart}
                            onChange={(e) => {
                              setEditStart(e.target.value);
                              if (kind === 'short' && e.target.value && !editEnd) {
                                setEditEnd(shortTermEndDate(e.target.value));
                              }
                            }} />
                        </div>
                        <div>
                          <label className="label">終了日</label>
                          <input className="field" type="date" value={editEnd}
                            onChange={(e) => setEditEnd(e.target.value)} />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button className="btn-primary btn-sm" onClick={saveEdit}>保存する</button>
                        <button className="btn-sub btn-sm" onClick={() => setEditingId(null)}>
                          キャンセル
                        </button>
                      </div>
                      <p className="text-gray-500">
                        保存済みの月の記録には、当時の目標がそのまま残ります。
                      </p>
                    </div>
                  ) : (
                    <>
                      <p className="text-gray-500">
                        {t.startDate} 〜 {t.endDate || '（終了日未定）'}
                      </p>
                      <p className="text-lg whitespace-pre-line">{t.text}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <button className="btn-sub btn-sm" onClick={() => startEdit(t)}>
                          編集する
                        </button>
                        <button className="btn-danger btn-sm" onClick={() => {
                          if (confirm('この目標を履歴から削除します。保存済みの月の記録は変わりません。よろしいですか？')) {
                            removeGoalTerm(t.goalTermId);
                          }
                        }}>削除</button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
