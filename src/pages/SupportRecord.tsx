/**
 * 支援記録の作成画面。
 *
 * ・チェック項目を選ぶと、定型文を組み立てて文章のたたき台を作る
 * ・外部通信は一切行わない（生成AI・外部APIを使わない）
 * ・入力されていない事実は文章に出さない
 * ・作った文章は職員が確認・編集してから保存する
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { newRecordId, useAppStore } from '../store/useAppStore';
import { buildSupportText, displayTextOf } from '../lib/supportText';
import {
  ASSISTANCE_OPTIONS, CATEGORY_LABELS, GAIT_OPTIONS, STANDUP_OPTIONS,
  itemsOf, type SupportCategory,
} from '../lib/supportCatalog';
import type { SupportMeasures, SupportRecord as SupportRecordType } from '../types';

const CATEGORY_ORDER: SupportCategory[] = ['physical', 'adl', 'support', 'wish'];

export default function SupportRecord() {
  const { memberId = '' } = useParams();
  const navigate = useNavigate();
  const {
    members, supportRecords, addSupportRecord, updateSupportRecord, removeSupportRecord,
  } = useAppStore();

  const member = members.find((m) => m.id === memberId);

  const records = useMemo(
    () =>
      supportRecords
        .filter((r) => r.memberId === memberId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [supportRecords, memberId]
  );

  const [checked, setChecked] = useState<string[]>([]);
  const [baseline, setBaseline] = useState<SupportMeasures>({});
  const [current, setCurrent] = useState<SupportMeasures>({});
  const [note, setNote] = useState('');
  const [text, setText] = useState<string | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!member) {
    return (
      <div className="card text-center space-y-4">
        <p className="text-xl">この利用者は見つかりませんでした（削除された可能性があります）。</p>
        <Link to="/members" className="btn-primary">利用者管理へ戻る</Link>
      </div>
    );
  }

  const toggle = (id: string) =>
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const build = () => {
    const { text: t } = buildSupportText({ checkedItems: checked, baseline, current, note });
    setText(t);
    setCopied(false);
  };

  const save = () => {
    if (!text) return;
    const now = new Date().toISOString();
    if (editingRecordId) {
      updateSupportRecord(editingRecordId, {
        checkedItems: checked, baseline, current, note, editedText: text,
      });
    } else {
      const rec: SupportRecordType = {
        recordId: newRecordId(),
        memberId,
        createdAt: now,
        updatedAt: now,
        checkedItems: checked,
        baseline,
        current,
        note,
        generatedText: text,
      };
      addSupportRecord(rec);
      setEditingRecordId(rec.recordId);
    }
  };

  const loadRecord = (r: SupportRecordType) => {
    setChecked(r.checkedItems ?? []);
    setBaseline(r.baseline ?? {});
    setCurrent(r.current ?? {});
    setNote(r.note ?? '');
    setText(displayTextOf(r));
    setEditingRecordId(r.recordId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const startNew = () => {
    setChecked([]); setBaseline({}); setCurrent({}); setNote('');
    setText(null); setEditingRecordId(null);
  };

  const measureRow = (
    label: string,
    options: readonly string[],
    key: 'gait' | 'standUp' | 'assistance'
  ) => (
    <div className="grid grid-cols-3 gap-2 items-center">
      <span className="text-base sm:text-lg font-bold text-gray-700">{label}</span>
      <select className="field" value={baseline[key] ?? ''}
        onChange={(e) => setBaseline({ ...baseline, [key]: e.target.value || undefined })}>
        <option value="">未入力</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <select className="field" value={current[key] ?? ''}
        onChange={(e) => setCurrent({ ...current, [key]: e.target.value || undefined })}>
        <option value="">未入力</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* 見出し */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-gray-500 text-lg">支援記録</p>
            <h2 className="text-2xl sm:text-3xl font-bold">{member.name}さん</h2>
          </div>
          <div className="w-full sm:w-auto sm:ml-auto flex gap-2">
            <button className="btn-sub btn-sm flex-1 sm:flex-none" onClick={() => navigate('/members')}>
              利用者管理へ戻る
            </button>
            {(text || checked.length > 0) && (
              <button className="btn-sub btn-sm flex-1 sm:flex-none" onClick={startNew}>
                新しい記録にする
              </button>
            )}
          </div>
        </div>
        <p className="text-gray-500 mt-2">
          〒{member.postalCode} {member.address}
          {member.requiresWheelchair && <span className="badge bg-accentSoft text-accent ml-2">車いす</span>}
        </p>
      </div>

      {/* チェック項目 */}
      {CATEGORY_ORDER.map((cat) => (
        <div key={cat} className="card">
          <h3 className="text-xl sm:text-2xl font-bold mb-3">{CATEGORY_LABELS[cat]}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
            {itemsOf(cat).map((item) => {
              const on = checked.includes(item.id);
              return (
                <button key={item.id} onClick={() => toggle(item.id)}
                  className={
                    'text-left rounded-2xl border-2 p-3 sm:p-4 transition ' +
                    (on ? 'border-accent bg-accentSoft' : 'border-gray-200 bg-white hover:bg-gray-50')
                  }>
                  <span className="flex items-center gap-3">
                    <span className={
                      'w-7 h-7 rounded-lg grid place-items-center text-lg font-bold border-2 shrink-0 ' +
                      (on ? 'bg-accent text-white border-accent' : 'border-gray-300 text-transparent')
                    }>✓</span>
                    <span className="text-base sm:text-lg font-bold">{item.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* 利用開始時と現在の比較（任意） */}
      <div className="card">
        <h3 className="text-xl sm:text-2xl font-bold mb-1">利用開始時と現在の比較（任意）</h3>
        <p className="text-gray-500 mb-4">
          入力した項目だけが文章に反映されます。未入力の項目は文章に出ません。
        </p>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <span />
          <span className="text-base font-bold text-gray-700">利用開始時</span>
          <span className="text-base font-bold text-gray-700">現在</span>
        </div>
        <div className="space-y-3">
          {measureRow('歩行状態', GAIT_OPTIONS, 'gait')}
          {measureRow('立ち上がり', STANDUP_OPTIONS, 'standUp')}
          {measureRow('介助量', ASSISTANCE_OPTIONS, 'assistance')}
          <div className="grid grid-cols-3 gap-2 items-center">
            <span className="text-base sm:text-lg font-bold text-gray-700">歩行距離(m)</span>
            <input className="field" type="number" inputMode="numeric" placeholder="未入力"
              value={baseline.walkDistanceM ?? ''}
              onChange={(e) =>
                setBaseline({
                  ...baseline,
                  walkDistanceM: e.target.value === '' ? undefined : Number(e.target.value),
                })
              } />
            <input className="field" type="number" inputMode="numeric" placeholder="未入力"
              value={current.walkDistanceM ?? ''}
              onChange={(e) =>
                setCurrent({
                  ...current,
                  walkDistanceM: e.target.value === '' ? undefined : Number(e.target.value),
                })
              } />
          </div>
        </div>
      </div>

      {/* 補足メモ */}
      <div className="card">
        <h3 className="text-xl sm:text-2xl font-bold mb-3">補足メモ（任意）</h3>
        <textarea className="field min-h-[6rem]" value={note} placeholder="例：ご家族より自宅での様子について相談があった"
          onChange={(e) => setNote(e.target.value)} />
        <p className="text-gray-500 mt-2">入力した内容は、そのまま文章の末尾に載ります。</p>
      </div>

      <button className="btn-primary w-full text-xl sm:text-2xl py-5 sm:py-6" onClick={build}>
        文章を作成する
      </button>

      {/* 作成結果 */}
      {text !== null && (
        <div className="card space-y-3">
          <h3 className="text-xl sm:text-2xl font-bold">作成した文章</h3>
          <textarea className="field min-h-[12rem] leading-relaxed" value={text}
            onChange={(e) => { setText(e.target.value); setCopied(false); }} />
          <p className="text-gray-600">
            ※入力された情報をもとに自動生成した文章です。内容を確認・修正してから記録してください。
          </p>
          <div className="flex flex-wrap gap-3">
            <button className="btn-sub" onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
              } catch {
                setCopied(false);
                alert('コピーできませんでした。文章を選択して手動でコピーしてください。');
              }
            }}>
              {copied ? 'コピーしました' : 'コピー'}
            </button>
            <button className="btn-primary" onClick={save}>
              {editingRecordId ? '上書き保存する' : '保存する'}
            </button>
          </div>
        </div>
      )}

      {/* 過去の記録 */}
      <div className="card">
        <h3 className="text-xl sm:text-2xl font-bold mb-3">これまでの記録（{records.length}件）</h3>
        {records.length === 0 ? (
          <p className="text-gray-500 text-lg">まだ保存された記録はありません。</p>
        ) : (
          <ul className="space-y-3">
            {records.map((r) => (
              <li key={r.recordId}
                className={
                  'rounded-2xl border-2 p-4 ' +
                  (r.recordId === editingRecordId ? 'border-accent bg-accentSoft' : 'border-gray-200')
                }>
                <p className="text-gray-500">
                  {new Date(r.createdAt).toLocaleString('ja-JP')}
                  {r.updatedAt !== r.createdAt && '（修正あり）'}
                </p>
                <p className="text-lg whitespace-pre-line mt-1">{displayTextOf(r)}</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button className="btn-sub btn-sm" onClick={() => loadRecord(r)}>開いて修正する</button>
                  <button className="btn-danger btn-sm"
                    onClick={() => {
                      if (confirm('この記録を削除します。元に戻せません。よろしいですか？')) {
                        removeSupportRecord(r.recordId);
                        if (editingRecordId === r.recordId) startNew();
                      }
                    }}>削除</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <p className="text-gray-600">
          支援記録は、利用者の氏名とともに<strong>この端末のブラウザ内にのみ保存</strong>されます。
          外部のサービスへ送信されることはありません（文章の作成もこの端末内で行っています）。
          バックアップの書き出しでは、既定で支援記録を含めません。
        </p>
      </div>
    </div>
  );
}
