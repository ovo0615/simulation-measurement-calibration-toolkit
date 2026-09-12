// 共用元件。
//
// 一個設計原則貫穿全部：**警告要顯眼、要說得出理由、要難以忽略。** 這個工具
// 存在的價值就是擋下「曲線疊得漂亮但數字是錯的」結果，把警告做成一行小灰字
// 等於把價值丟掉。

import { useCallback, useRef, useState } from "react";
import type { Finding, UploadInfo } from "./api";

export function Findings({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;
  const order = { block: 0, warn: 1, info: 2 } as const;
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);
  const label = { block: "擋下", warn: "警告", info: "說明" } as const;
  return (
    <div>
      {sorted.map((finding, index) => (
        <div key={`${finding.code}-${index}`} className={`finding ${finding.severity}`}>
          <strong>［{label[finding.severity]}］{finding.message}</strong>
          {finding.detail ? <div className="detail">{finding.detail}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function FileDrop({
  title,
  hint,
  info,
  busy,
  onFile,
}: {
  title: string;
  hint: string;
  info: UploadInfo | null;
  busy: boolean;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div
      className={`drop ${info ? "filled" : ""}`}
      style={dragging ? { borderColor: "var(--accent)" } : undefined}
      onClick={() => input.current?.click()}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={input}
        type="file"
        accept=".s1p,.s2p,.s3p,.s4p,.s8p,.csv,.txt"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
        }}
      />
      <strong>{title}</strong>
      {busy ? (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>讀取中…</div>
      ) : info ? (
        <dl>
          <dt>檔案</dt>
          <dd>{info.label}</dd>
          <dt>埠數</dt>
          <dd>{info.n_port}</dd>
          <dt>頻段</dt>
          <dd>
            {info.f_start_ghz.toFixed(4)} – {info.f_stop_ghz.toFixed(4)} GHz（
            {info.n_points} 點）
          </dd>
          <dt>參考阻抗</dt>
          <dd>{info.z_ref} Ω</dd>
        </dl>
      ) : (
        <div style={{ color: "var(--muted)", fontSize: 13 }}>{hint}</div>
      )}
    </div>
  );
}

export function Svg({ markup }: { markup: string }) {
  // 後端產生的 SVG 是純字串組裝、沒有外部資源，直接內嵌。不用 img+data URL
  // 是為了讓它跟著頁面縮放、也能被瀏覽器搜尋到圖上的文字。
  return <div className="chart" dangerouslySetInnerHTML={{ __html: markup }} />;
}

// 「打到一半」的數字：指數符號後面還沒有數字、只剩正負號、或只有小數點。
// 這些字串 parseFloat 得出值（"4e" → 4），所以不能只靠 Number.isFinite 判斷。
function incompleteText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return true;
  return /[eE][+-]?$/.test(trimmed) || /^[+-]?$/.test(trimmed) || /^[+-]?\.$/.test(trimmed);
}

export function NumberField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  // step 刻意拿掉：type="text" 上它完全沒有作用，留著只會讓呼叫端以為有效。
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  // 用 type="text" 而不是 type="number"。
  //
  // `<input type="number">` 在**輸入中途不合法**時（打到 "4e" 還沒打指數）
  // 會讓 `event.target.value` 變成空字串——不是 "4e"。於是 parseFloat 得到
  // NaN，受控元件把值還原，使用者看到的是「e 打不進去」。
  // 實測踩過：要輸入 4e-7 只能用複製貼上。
  //
  // draft 讓輸入中途的字串留在畫面上，只有解析得出數字時才往上送。
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? String(value) : "");
  const incomplete = draft !== null && incompleteText(draft);

  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={shown}
        disabled={disabled}
        aria-invalid={incomplete || undefined}
        style={incomplete ? { borderColor: "var(--warn)" } : undefined}
        onFocus={() => setDraft(String(value))}
        onChange={(event) => {
          setDraft(event.target.value);
          const next = parseFloat(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        onBlur={() => {
          // 失焦時**不要無聲地丟掉使用者打的字**。打 "4e" 然後點別處，
          // 舊版會跳回 4（parseFloat("4e") = 4），使用者看不出發生了什麼。
          // 打完整的就正規化顯示；打一半的就留在畫面上並標成待補完。
          if (draft === null) return;
          const next = parseFloat(draft);
          if (Number.isFinite(next) && String(next) === draft.trim()) {
            setDraft(null);
          } else if (Number.isFinite(next) && !incompleteText(draft)) {
            onChange(next);
            setDraft(null);
          }
        }}
      />
      {incomplete ? (
        <span style={{ color: "var(--warn)", fontSize: 12 }}>
          還沒打完（指數要接數字，例如 4e-7）
        </span>
      ) : null}
    </label>
  );
}
