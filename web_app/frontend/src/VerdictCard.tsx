// 判定卡。**只負責畫，不判斷任何事。**
//
// 判定、原因、建議、標籤全部由後端組（domain/sparam/conclusion.py），這裡
// 拿到什麼就畫什麼。前端唯一自己決定的是「語氣要對應到哪個 class」——那是
// 呈現的事，後端不該知道。
//
// 為什麼要獨立成一個檔案：先前這段 JSX 內嵌在 CalibratePane 裡，測試只能
// 讀原始碼搜字串，驗不到「欄位接錯位置」「放在走不到的分支」「樣式套錯」。
// 抽出來之後可以真的渲染它。這與後端把 export_for、release_and_report 抽成
// 函式是同一件事：**測試需要複製產品邏輯，就代表產品缺一個可以打的東西。**

import type { Conclusion } from "./api";

const TONE_CLASS: Record<string, string> = {
  good: "ok",
  caution: "partial",
  bad: "bad",
};

export function VerdictCard({
  conclusion,
  warnings,
}: {
  conclusion: Conclusion;
  warnings: string[];
}) {
  // 未知的語氣往最嚴重的那邊倒。後端加了新語氣而前端還沒跟上時，寧可畫得
  // 太嚴重，也不要畫成沒有樣式的一片白。
  const tone = TONE_CLASS[conclusion.tone] ?? "bad";

  return (
    <div className={`verdict ${tone}`} data-testid="verdict-card">
      <strong>{conclusion.label}</strong>
      {conclusion.headline}

      {conclusion.reasons.length > 0 ? (
        <ul data-testid="verdict-reasons">
          {conclusion.reasons.map((reason, index) => (
            <li key={index}>{reason.text}</li>
          ))}
        </ul>
      ) : null}

      {/* 由後端說要不要列，不要在這裡判斷 verdict 是不是 "partial" */}
      {conclusion.reports_usable ? (
        <p style={{ margin: "6px 0 0" }} data-testid="verdict-usable">
          可以採用：{conclusion.usable.join("、") || "（無）"}
        </p>
      ) : null}

      {conclusion.advice.map((text, index) => (
        <p key={index} style={{ margin: "4px 0 0", fontSize: 14 }}>
          {text}
        </p>
      ))}

      {warnings.length > 0 ? (
        <ul style={{ marginTop: 8, fontSize: 14 }} data-testid="verdict-warnings">
          {warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
