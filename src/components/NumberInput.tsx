/**
 * 数値入力欄。
 *
 * 素の <input type="number"> に Number(e.target.value) を直結すると、
 * 「一度消してから打ち直す」操作で事故が起きる。
 *   例) 8 を消す → 空文字 → Number('')=0 → 下限1に補正されて 1 になる
 *       → そこへ 7 を打つと "17" になってしまう
 * そのため入力中は文字列のまま保持し、確定できる値のときだけ親へ通知する。
 * 範囲の補正は入力中ではなく、フォーカスが外れたときに行う。
 */
import { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** 整数のみ受け付ける（定員・分数など） */
  integer?: boolean;
  className?: string;
  placeholder?: string;
}

export default function NumberInput({
  value, onChange, min, max, step, integer, className = 'field', placeholder,
}: Props) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  // 外部から値が変わったときは表示を合わせる（入力中は邪魔しない）
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  const clamp = (n: number) => {
    let v = integer ? Math.round(n) : n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  };

  return (
    <input
      className={className}
      type="number"
      inputMode={integer ? 'numeric' : 'decimal'}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      value={text}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        // 空欄や「-」「1.」の途中入力では親を更新しない
        if (t === '' || t === '-' || t === '.' || t.endsWith('.')) return;
        const n = Number(t);
        if (!Number.isFinite(n)) return;
        onChange(n);
      }}
      onBlur={() => {
        focused.current = false;
        const n = Number(text);
        const v = text === '' || !Number.isFinite(n) ? clamp(min ?? 0) : clamp(n);
        setText(String(v));
        if (v !== value) onChange(v);
      }}
    />
  );
}
