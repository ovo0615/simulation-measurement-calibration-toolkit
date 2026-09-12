// 求解器選擇。
//
// 兩個求解器差三到四個數量級的速度，所以介面上必須把「這會跑多久」講清楚，
// 而不是讓使用者按下去之後才發現要等半小時。
//
// 另一件必須講的是：兩者對「粗糙度」的定義已經被統一成 Hammerstad 的 RMS
// 粗糙度（Q2D 解光滑導體，粗糙度由本工具套上去），所以校正結果可以在兩個
// 求解器之間搬動。不統一的話，同一個數字在兩邊意義不同，而那種不一致不會
// 有任何錯誤訊息。

import type { SolverInfo } from "./api";

// 與後端 campaign.py 的預設值一致：DOE = 10×維度+10，加精修與收尾。
function estimateSolves(parameterCount: number): number {
  const doe = Math.max(10 * parameterCount + 10, 20) + 2;
  const refine = 3 * 6;
  const polish = 120;
  const identifiability = 2 * parameterCount * parameterCount + 1;
  return doe + refine + polish + identifiability;
}

function formatDuration(seconds: number): string {
  // 不要顯示「0 秒」。四捨五入到 0 會讓人以為估算壞了，而不是以為它很快。
  if (seconds < 1) return "不到 1 秒";
  if (seconds < 90) return `${Math.round(seconds)} 秒`;
  if (seconds < 5400) return `約 ${Math.round(seconds / 60)} 分鐘`;
  return `約 ${(seconds / 3600).toFixed(1)} 小時`;
}

export function SolverPicker({
  solvers,
  value,
  onChange,
  disabled,
  parameterCount,
}: {
  solvers: SolverInfo[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
  parameterCount: number;
}) {
  if (solvers.length === 0) return null;

  const solves = estimateSolves(parameterCount);
  const selected = solvers.find((s) => s.id === value);

  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "4px 0 14px" }}>
        {solvers.map((solver) => {
          const estimate = solves * solver.seconds_per_solve;
          const active = solver.id === value;
          return (
            <button
              key={solver.id}
              className="ghost"
              disabled={disabled || !solver.available}
              onClick={() => onChange(solver.id)}
              style={{
                textAlign: "left",
                flex: "1 1 260px",
                padding: "12px 16px",
                borderColor: active ? "var(--accent)" : undefined,
                background: active ? "#eff6ff" : undefined,
                opacity: solver.available ? 1 : 0.55,
                cursor: solver.available && !disabled ? "pointer" : "not-allowed",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>
                {active ? "● " : "○ "}
                {solver.name}
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                {solver.available
                  ? `約 ${solves} 次求解，${formatDuration(estimate)}${
                      solver.id === "q2d" ? "（上限；幾何不變的點會重用結果）" : ""
                    }`
                  : solver.reason}
              </div>
            </button>
          );
        })}
      </div>

      {selected ? (
        <div className={`finding ${selected.id === "q2d" ? "warn" : "info"}`}>
          <strong>
            ［{selected.id === "q2d" ? "注意" : "說明"}］{selected.name}
          </strong>
          <div className="detail">
            {selected.notes}
            {selected.id === "q2d" ? (
              <>
                {"\n"}
                粗糙度仍由本工具用 Hammerstad 的 RMS 模型套上去（Q2D 解光滑導體），
                所以同一個粗糙度值在兩個求解器裡意義相同，校正結果可以互相搬動。
                {"\n"}
                求解過程會佔用一份 AEDT 授權，工作結束會自動放開，但不會關閉桌面。
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
