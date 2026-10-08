// 差動量測面板：四埠單端 → P370 品質檢查 → 差模二埠（SDD）。
//
// 兩件事刻意不給捷徑：
//
//   1. 埠序由人選。檔案本身不會說是哪一種，選錯時 SDD21 變成串音，曲線照樣
//      平滑。後端會用低頻 SDD21 做物理檢查，不過就擋，並列出另一種埠序的值。
//   2. P370 不過**不給覆寫**。這是差動量測進入校正前的關卡，給了「我了解」
//      就等於沒有關卡。

import { useState } from "react";
import { ApiError, PORT_ORDERS, prepareDifferential } from "./api";
import type { DifferentialInfo, Finding, PortOrder, UploadInfo } from "./api";
import { Findings } from "./components";

// 兩條線完全對稱時轉換量是數值零（−300 dB），照印會讓人以為算錯了。
function conversion(db: number): string {
  return db < -100 ? "低於 −100 dB" : `${db.toFixed(1)} dB`;
}

export function DifferentialPanel({
  measured,
  differential,
  onPrepared,
  disabled,
}: {
  measured: UploadInfo | null;
  differential: DifferentialInfo | null;
  onPrepared: (info: DifferentialInfo | null) => void;
  disabled: boolean;
}) {
  const [portOrder, setPortOrder] = useState<PortOrder>("13_24");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<Finding[]>([]);
  const [error, setError] = useState("");

  // 只有四埠量測才有差動可言。單端二埠的流程完全不受這個面板影響。
  if (!measured || measured.n_port !== 4) return null;

  const run = async () => {
    setBusy(true);
    setBlocked([]);
    setError("");
    onPrepared(null);
    try {
      onPrepared(await prepareDifferential(measured.token, portOrder));
    } catch (exc) {
      if (exc instanceof ApiError && exc.status === 409) {
        const detail = exc.detail as { findings?: Finding[]; message?: string };
        setBlocked(
          detail.findings?.length
            ? detail.findings
            : [{ severity: "block", code: "rejected", message: detail.message ?? "請求被拒絕" }],
        );
      } else {
        setError(exc instanceof Error ? exc.message : String(exc));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>差動量測（四埠 → 差模）</h2>
      {/* 中文句子不在 JSX 裡斷行：斷行會變成一個多餘的空白。 */}
      <p className="hint">
        {"這份量測是四埠。要校正差動對，先轉成差模二埠（S21 就是 SDD21、參考阻抗 100 Ω）。轉換前會先做 "}
        <strong>IEEE P370 品質檢查</strong>
        {"（因果、被動、互易）——差模任一項「差」就擋下，"}
        <strong>不能覆寫</strong>
        {"：最佳化會拿 Dk／Df 去追量測本身的問題。"}
      </p>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="field" style={{ minWidth: 320 }}>
          <span>埠序（請對照量測接線）</span>
          <select
            value={portOrder}
            disabled={disabled || busy}
            onChange={(event) => {
              setPortOrder(event.target.value as PortOrder);
              // 換埠序後舊的差模結果就不對應了，不能留著被拿去校正。
              onPrepared(null);
              setBlocked([]);
            }}
          >
            {PORT_ORDERS.map((order) => (
              <option key={order.id} value={order.id}>
                {order.label}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={disabled || busy} onClick={run}>
          {busy ? "檢查中…" : "P370 檢查並轉成差模"}
        </button>
      </div>
      {error ? <div className="error">{error}</div> : null}

      {blocked.length > 0 ? (
        <div style={{ marginTop: 14 }} data-testid="differential-blocked">
          <Findings findings={blocked} />
        </div>
      ) : null}
      {blocked.length > 0 ? (
        <p className="hint" style={{ marginTop: 10 }}>
          這不是可以覆寫的警告。請確認埠序、校準與去嵌後重新量測或重新匯出。
        </p>
      ) : null}

      {differential ? (
        <div style={{ marginTop: 14 }} data-testid="differential-ready">
          <div className="finding info">
            <strong>
              ［說明］已轉成差模：{differential.label}，參考阻抗 {differential.z_ref} Ω
            </strong>
            <div className="detail">
              {`${differential.port_order_label}。差模轉共模最大 ${conversion(differential.mode_conversion_db)}。校正會用這份差模資料，截面已切到「差動帶線」。`}
            </div>
          </div>
          <Findings findings={differential.findings.filter((f) => f.severity !== "info")} />
          <details style={{ marginTop: 8 }}>
            <summary>P370 檢查明細</summary>
            <Findings findings={differential.findings.filter((f) => f.severity === "info")} />
          </details>
        </div>
      ) : null}
    </section>
  );
}
