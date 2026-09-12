// 主畫面。兩個分頁對應兩種模式：
//
//   比較模式  零門檻，兩個檔案就能用。這是工具的入口。
//   校正模式  要有可調的模型（v1 是純疊構參數化截面）。
//
// 校正的結果永遠先講「可不可信」再講數字。把 Df = 0.0134 放在最上面、把
// 「本次結果不可信」擺在下面某處的介面，實務上等於沒有那個警告。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  cancelJob,
  compare,
  detectDeltaL,
  extractDeltaL,
  jobStatus,
  listSolvers,
  materialsUrl,
  reportUrl,
  startCalibration,
  tableUrl,
  upload,
  watchJob,
} from "./api";
import type {
  BandSpec,
  CalibrationResult,
  CompareResult,
  DeltaLExtraction,
  Finding,
  JobEvent,
  ParameterSpec,
  SectionSpec,
  SolverInfo,
  UploadInfo,
} from "./api";
import { FileDrop, Findings, NumberField, Svg } from "./components";
import { DeltaLPanel } from "./DeltaLPanel";
import { LayoutPanel } from "./LayoutPanel";
import { SolverPicker } from "./SolverPicker";
import { VerdictCard } from "./VerdictCard";

const DEFAULT_SECTION: SectionSpec = {
  material_name: "FR4",
  dk: 4.0,
  df: 0.01,
  f_ref_ghz: 1.0,
  width_um: 150,
  height_um: 500,
  thickness_um: 35,
  length_mm: 76.2,
  roughness_um: 0.4,
  geometry: "stripline",
};

const STAGE_LABEL: Record<string, string> = {
  doe: "DOE 取樣求解",
  surrogate: "擬合代理模型",
  optimize: "在響應面上最佳化",
  refine: "自適應精修",
  polish: "真求解器局部收尾",
  verify: "真求解驗證",
  identifiability: "可辨識性分析",
  crossvalidate: "交叉驗證（第二個模型）",
  finished: "完成",
  failed: "失敗",
  cancelled: "已中止",
};

export default function App() {
  const [tab, setTab] = useState<"compare" | "calibrate">("compare");
  const [simulated, setSimulated] = useState<UploadInfo | null>(null);
  const [measured, setMeasured] = useState<UploadInfo | null>(null);

  return (
    <>
      <header className="app">
        <h1>模擬與量測比較校正工具</h1>
        <span>S 參數．因果色散模型．殘差診斷</span>
      </header>
      <nav className="tabs">
        <button className={tab === "compare" ? "active" : ""} onClick={() => setTab("compare")}>
          比較模式
        </button>
        <button
          className={tab === "calibrate" ? "active" : ""}
          onClick={() => setTab("calibrate")}
        >
          校正模式
        </button>
      </nav>
      <main>
        {tab === "compare" ? (
          <ComparePane
            simulated={simulated}
            measured={measured}
            setSimulated={setSimulated}
            setMeasured={setMeasured}
          />
        ) : (
          <CalibratePane measured={measured} setMeasured={setMeasured} />
        )}
      </main>
    </>
  );
}

// ── 比較模式 ────────────────────────────────────────────────────

function ComparePane({
  simulated,
  measured,
  setSimulated,
  setMeasured,
}: {
  simulated: UploadInfo | null;
  measured: UploadInfo | null;
  setSimulated: (info: UploadInfo | null) => void;
  setMeasured: (info: UploadInfo | null) => void;
}) {
  const [busy, setBusy] = useState<"simulated" | "measured" | "compare" | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(
    async (file: File, origin: "simulated" | "measured") => {
      setBusy(origin);
      setError("");
      try {
        const info = await upload(file, origin);
        if (origin === "simulated") setSimulated(info);
        else setMeasured(info);
        setResult(null);
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : String(exc));
      } finally {
        setBusy(null);
      }
    },
    [setSimulated, setMeasured],
  );

  const run = useCallback(async () => {
    if (!simulated || !measured) return;
    setBusy("compare");
    setError("");
    try {
      setResult(await compare(simulated.token, measured.token));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  }, [simulated, measured]);

  return (
    <>
      <section className="panel">
        <h2>載入兩份響應</h2>
        <p className="hint">
          支援 Touchstone（.s2p／.s4p…）與 VNA 匯出的 CSV。CSV 的頻率欄必須標示單位
          ——本工具不猜單位，猜錯會讓整份結果差一個數量級而不報錯。
        </p>
        <div className="grid2">
          <FileDrop
            title="模擬"
            hint="點擊或拖放檔案"
            info={simulated}
            busy={busy === "simulated"}
            onFile={(file) => load(file, "simulated")}
          />
          <FileDrop
            title="量測"
            hint="點擊或拖放檔案"
            info={measured}
            busy={busy === "measured"}
            onFile={(file) => load(file, "measured")}
          />
        </div>
        {error ? <div className="error">{error}</div> : null}
        <div style={{ marginTop: 18 }}>
          <button
            className="primary"
            disabled={!simulated || !measured || busy !== null}
            onClick={run}
          >
            {busy === "compare" ? "比較中…" : "比較"}
          </button>
        </div>
      </section>

      {result ? (
        <>
          <section className="panel">
            <h2>前置檢查</h2>
            <p className="hint">
              這些檢查在任何最佳化之前跑完。最佳化會忠實地把不對等吸收進材料參數，
              而且吸收得很成功——等到事後才發現埠序錯了，你已經有一組漂亮的錯答案。
            </p>
            {result.findings.length === 0 ? (
              <div className="finding info">
                <strong>［說明］沒有發現問題</strong>
              </div>
            ) : (
              <Findings findings={result.findings} />
            )}
          </section>

          {result.summary ? (
            <section className="panel">
              <h2>整體差異</h2>
              <table>
                <tbody>
                  <tr>
                    <th>共同頻段</th>
                    <td className="num">
                      {result.summary.f_start_ghz.toFixed(4)} –{" "}
                      {result.summary.f_stop_ghz.toFixed(4)} GHz（{result.summary.n_points} 點）
                    </td>
                  </tr>
                  <tr>
                    <th>幅度 RMS 差</th>
                    <td className="num">{result.summary.rms_magnitude_db.toFixed(4)} dB</td>
                  </tr>
                  <tr>
                    <th>群延遲 RMS 差</th>
                    <td className="num">{result.summary.rms_group_delay_ps.toFixed(2)} ps</td>
                  </tr>
                </tbody>
              </table>
            </section>
          ) : null}

          {result.charts.map((pair) => (
            <section className="panel" key={pair.entry}>
              <h2>{pair.entry}</h2>
              <Svg markup={pair.magnitude} />
              <Svg markup={pair.group_delay} />
            </section>
          ))}
        </>
      ) : null}
    </>
  );
}

// ── 校正模式 ────────────────────────────────────────────────────

function CalibratePane({
  measured,
  setMeasured,
}: {
  measured: UploadInfo | null;
  setMeasured: (info: UploadInfo | null) => void;
}) {
  const [section, setSection] = useState<SectionSpec>(DEFAULT_SECTION);
  const [bands, setBands] = useState<BandSpec[]>([
    {
      f_start_ghz: 0.1,
      f_stop_ghz: 20,
      entry: "S21",
      weight: 1,
      weight_magnitude: 0.7,
      weight_group_delay: 0.3,
    },
  ]);
  const [parameters, setParameters] = useState<ParameterSpec[]>([
    { name: "FR4.dk_ref", value: 4.0, lower: 3.2, upper: 4.8, group: "FR4" },
    { name: "FR4.df_ref", value: 0.01, lower: 0.004, upper: 0.025, group: "FR4" },
  ]);
  const [deltaL, setDeltaL] = useState<DeltaLExtraction | null>(null);
  const [layoutNet, setLayoutNet] = useState("");
  const [solvers, setSolvers] = useState<SolverInfo[]>([]);
  const [solverId, setSolverId] = useState("analytic");
  // 交叉驗證用的第二個求解器。空字串代表不做。
  //
  // 這是報告裡唯一看得到模型偏差的檢查——模型偏差不會在殘差裡留下形狀，
  // 殘差診斷與可辨識性分析都只在同一個模型內部看事情。
  const [crossSolver, setCrossSolver] = useState("");
  // 沒驗成時工具會叫使用者提高這個值，所以它必須是可以改的。
  const [crossBudget, setCrossBudget] = useState(120);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [blocking, setBlocking] = useState<Finding[]>([]);
  // 可否覆寫由**後端**決定。先前這裡寫死了三個 409 代碼，後端每加一種就
  // 要同步改前端，忘了改就會出現一個不該給的「我了解」欄位。
  const [overridable, setOverridable] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState("");
  const [jobId, setJobId] = useState("");
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const stop = useRef<null | (() => void)>(null);

  // 參數名的字首要跟著材料名走，否則求解器會說「參數指向材料 X，
  // 但本截面的材料是 Y」——那是對的行為，但在 UI 上讓人一頭霧水。
  useEffect(() => {
    setParameters((current) =>
      current.map((p) =>
        p.name.endsWith(".dk_ref") || p.name.endsWith(".df_ref")
          ? { ...p, name: `${section.material_name}.${p.name.split(".").pop()}`,
              group: section.material_name }
          : p,
      ),
    );
  }, [section.material_name]);

  useEffect(() => () => stop.current?.(), []);

  useEffect(() => {
    listSolvers().then((r) => setSolvers(r.solvers)).catch(() => setSolvers([]));
  }, []);

  // 相減之後校正的對象是「差段」，不是任何一條原本的線。線長鎖成 ΔL 而不是
  // 讓使用者自己填——後端也會硬擋不符的長度，但在這裡就鎖住，使用者才不會
  // 一路以為自己在校正 76.2 mm 的那條線。
  useEffect(() => {
    // 修掉浮點雜訊：50.800000000000004 會讓人以為工具算錯了。
    // ΔL 是兩個長度相減來的，1e-9 mm 的差異沒有任何物理意義。
    if (deltaL)
      setSection((current) => ({
        ...current,
        length_mm: Math.round(deltaL.delta_length_mm * 1e6) / 1e6,
      }));
  }, [deltaL]);

  const poll = useCallback(async (id: string) => {
    for (;;) {
      const info = await jobStatus(id);
      setStatus(info.status);
      if (info.status === "done") {
        setResult(info.result ?? null);
        return;
      }
      if (info.status === "failed" || info.status === "cancelled") {
        setError(info.error || "工作已中止");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }, []);

  const run = useCallback(async () => {
    if (!measured) return;
    setBusy(true);
    setError("");
    setBlocking([]);
    setOverridable(false);
    setResult(null);
    setEvents([]);
    // 舊的狀態要清掉。實測踩過：送出被 409 擋下的請求時，畫面仍停在上一次的
    // 「狀態：done」，看起來像「按了開始校正然後就完成了」。
    setStatus("");
    try {
      const started = await startCalibration({
        measured: deltaL ? deltaL.token : measured.token,
        section,
        parameters,
        bands,
        solver: solverId,
        cross_solver: crossSolver,
        cross_budget: crossBudget,
        acknowledge_blocking: acknowledgement,
      });
      setJobId(started.job_id);
      stop.current?.();
      stop.current = watchJob(started.job_id, (event) =>
        setEvents((current) => [...current.slice(-200), event]),
      );
      await poll(started.job_id);
    } catch (exc) {
      if (exc instanceof ApiError && exc.status === 409) {
        // 409 有好幾種：前置檢查未通過（帶 findings）、Delta-L 線長不符、
        // 校正區間的響應項不合法、求解器不可用。先前只處理第一種，其餘的
        // findings 是 undefined，結果畫面什麼都不顯示——按下去像沒反應。
        const detail = exc.detail as {
          findings?: Finding[];
          message?: string;
          detail?: string;
          reason?: string;
          overridable?: boolean;
        };
        setOverridable(detail.overridable === true);
        if (detail.findings?.length) {
          setBlocking(detail.findings);
        } else {
          setBlocking([
            {
              severity: "block",
              code: detail.reason ?? "rejected",
              message: detail.message ?? "請求被拒絕",
              detail: detail.detail,
            },
          ]);
        }
      } else {
        setError(exc instanceof Error ? exc.message : String(exc));
      }
    } finally {
      setBusy(false);
    }
  }, [measured, deltaL, section, parameters, bands, acknowledgement, solverId, poll]);

  const progress = useMemo(() => {
    const last = [...events].reverse().find((e) => e.total > 0);
    if (!last) return null;
    return { label: STAGE_LABEL[last.stage] ?? last.stage, done: last.done, total: last.total };
  }, [events]);

  return (
    <>
      <section className="panel">
        <h2>量測資料</h2>
        <p className="hint">
          校正的對象應該是一段<strong>均勻傳輸線</strong>（校正試片）。拿一整條含過孔
          與轉角的複雜通道反推材料是病態反問題——結構的建模誤差會全部被吸收進材料參數。
        </p>
        <FileDrop
          title="量測"
          hint="點擊或拖放 Touchstone／CSV"
          info={measured}
          busy={false}
          onFile={async (file) => {
            try {
              const info = await upload(file, "measured");
              // 換了量測檔就要把 Delta-L 丟掉。舊的 extraction 是**上一份**
              // 量測相減出來的，token 與 ΔL 都不再對應——留著的話按下開始
              // 校正會拿舊的差段去校正新的截面，而畫面上完全看不出來。
              setDeltaL(null);
              setMeasured(info);
            } catch (exc) {
              setError(exc instanceof Error ? exc.message : String(exc));
            }
          }}
        />
      </section>

      <LayoutPanel
        disabled={busy}
        onSection={(spec, netName) => {
          // Delta-L 相減之後校正的對象是差段，線長由 ΔL 決定。版面讀到的是
          // 那條走線的全長，直接套用會覆寫掉 ΔL——後端會擋，但在這裡就先保住。
          setSection(deltaL ? { ...spec, length_mm: deltaL.delta_length_mm } : spec);
          setParameters((current) =>
            current.map((p) =>
              p.name.includes(".dk_ref") || p.name.includes(".df_ref")
                ? { ...p, name: `${spec.material_name}.${p.name.split(".").pop()}`,
                    group: spec.material_name }
                : p,
            ),
          );
          setLayoutNet(netName);
        }}
      />

      <DeltaLPanel
        primary={measured}
        extraction={deltaL}
        onExtracted={setDeltaL}
        disabled={busy}
      />

      <SectionEditor
        section={section}
        onChange={setSection}
        disabled={busy}
        source={layoutNet}
        lockedLengthReason={
          deltaL
            ? `已由 Delta-L 相減決定：ΔL = ${deltaL.delta_length_mm.toFixed(3)} mm`
            : ""
        }
      />
      <BandEditor bands={bands} onChange={setBands} disabled={busy} />
      <ParameterEditor parameters={parameters} onChange={setParameters} disabled={busy} />

      {blocking.length > 0 ? (
        <section className="panel">
          <h2>{overridable ? "前置檢查未通過" : "無法開始校正"}</h2>
          <Findings findings={blocking} />
          {overridable ? (
            <>
              <p className="hint" style={{ marginTop: 14 }}>
                仍要繼續的話，請在下面輸入「我了解」。這裡刻意不用核取方塊——核取
                方塊會被順手勾掉，而覆寫之後的結果會在報告中被標記為不可信。
              </p>
              <div style={{ maxWidth: 260 }}>
                <input
                  value={acknowledgement}
                  placeholder="輸入：我了解"
                  onChange={(event) => setAcknowledgement(event.target.value)}
                />
              </div>
            </>
          ) : (
            // 這一類不是「風險自負可以覆寫」，是設定本身就錯了——不該給
            // 覆寫的欄位，否則使用者會以為打了「我了解」就能繞過去。
            <p className="hint" style={{ marginTop: 14 }}>
              這不是可以覆寫的警告，請依上面的說明修正設定後再試。
            </p>
          )}
        </section>
      ) : null}

      <section className="panel">
        <h2>執行</h2>
        <p className="hint">
          流程：DOE 取樣求解 → 擬合代理模型 → 在響應面上最佳化 → 自適應精修 →
          真求解器局部收尾 → 真求解驗證 → 可辨識性分析。
        </p>

        <SolverPicker
          solvers={solvers}
          value={solverId}
          onChange={setSolverId}
          disabled={busy}
          parameterCount={parameters.length}
        />

        <label className="field" style={{ marginTop: 12 }}>
          <span>交叉驗證（選用）</span>
          <select
            value={crossSolver}
            disabled={busy}
            onChange={(event) => setCrossSolver(event.target.value)}
          >
            <option value="">不做</option>
            <option value="analytic" disabled={solverId === "analytic"}>
              解析截面{solverId === "analytic" ? "（已是主求解器）" : ""}
            </option>
          </select>
        </label>
        {crossSolver ? (
          <div style={{ width: 220 }}>
            <NumberField
              label="交叉驗證的求解預算"
              value={crossBudget}
              step={20}
              disabled={busy}
              onChange={setCrossBudget}
            />
          </div>
        ) : null}
        <p className="hint" style={{ marginTop: 6 }}>
          用第二個模型從第一個模型的答案出發重擬合一次，看兩者給不給出同一組
          參數。<strong>這是唯一看得到模型偏差的檢查</strong>——模型自己偏了
          的時候，最佳化會把偏差吸收進參數，殘差因此仍然乾淨，殘差診斷與可
          辨識性分析都不會說話。實測用錯導體損耗公式時，殘差 0.003 dB（遠低
          於「乾淨」的 0.05 dB 門檻），而 Df 錯了 113%。
          <br />
          代價是第二個模型最多再跑 {crossBudget} 次求解（上面可以改）。兩個
          模型不同意的參數會被排除在可採用清單之外，也不會進材料庫；若預算
          不夠讓它跑完，判定會是「狀態不明」而不是「可信」。
        </p>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button className="primary" disabled={!measured || busy} onClick={run}>
            {busy ? "校正中…" : "開始校正"}
          </button>
          {busy && jobId ? (
            <button className="ghost" onClick={() => cancelJob(jobId)}>
              中止
            </button>
          ) : null}
          {status ? <span style={{ color: "var(--muted)", fontSize: 14 }}>狀態：{status}</span> : null}
        </div>
        {error ? <div className="error">{error}</div> : null}
        {progress ? (
          <>
            <div className="bar">
              <div style={{ width: `${(100 * progress.done) / Math.max(progress.total, 1)}%` }} />
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {progress.label} {progress.done}／{progress.total}
            </div>
          </>
        ) : null}
        {events.length > 0 ? (
          <div className="log" style={{ marginTop: 14 }}>
            {events.map((event, index) => (
              <div key={index}>
                {event.at}  {STAGE_LABEL[event.stage] ?? event.stage}
                {event.total > 0 ? `  ${event.done}/${event.total}` : ""}
                {event.message ? `  ${event.message}` : ""}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {result ? <ResultPane result={result} jobId={jobId} /> : null}
    </>
  );
}

function SectionEditor({
  section,
  onChange,
  disabled,
  lockedLengthReason = "",
  source = "",
}: {
  section: SectionSpec;
  onChange: (section: SectionSpec) => void;
  disabled: boolean;
  lockedLengthReason?: string;
  source?: string;
}) {
  const set = (patch: Partial<SectionSpec>) => onChange({ ...section, ...patch });
  return (
    <section className="panel">
      <h2>截面（純疊構參數化）</h2>
      <p className="hint">
        不需要 layout，有疊構加線寬就能建。stripline 是均質結構，Dk 與延遲直接對應；
        microstrip 有一部分場在空氣中，兩者的公式不同，選錯會讓校正出的 Dk 系統性偏高。
        {source ? `　目前的值讀自版面的 ${source}。` : ""}
      </p>
      <div className="grid3">
        <label className="field">
          <span>材料名稱</span>
          <input
            value={section.material_name}
            disabled={disabled}
            onChange={(event) => set({ material_name: event.target.value })}
          />
        </label>
        <label className="field">
          <span>結構</span>
          <select
            value={section.geometry}
            disabled={disabled}
            onChange={(event) => set({ geometry: event.target.value as SectionSpec["geometry"] })}
          >
            <option value="stripline">stripline（帶線）</option>
            <option value="microstrip">microstrip（微帶線）</option>
          </select>
        </label>
        <NumberField label="參考頻率（GHz）" value={section.f_ref_ghz} disabled={disabled}
          onChange={(v) => set({ f_ref_ghz: v })} />
        <NumberField label="Dk（起始值）" value={section.dk} step={0.01} disabled={disabled}
          onChange={(v) => set({ dk: v })} />
        <NumberField label="Df（起始值）" value={section.df} step={0.001} disabled={disabled}
          onChange={(v) => set({ df: v })} />
        <NumberField label="銅箔粗糙度 Rq（µm）" value={section.roughness_um} step={0.05}
          disabled={disabled} onChange={(v) => set({ roughness_um: v })} />
        <NumberField label="線寬（µm）" value={section.width_um} disabled={disabled}
          onChange={(v) => set({ width_um: v })} />
        <NumberField label="介質厚度（µm）" value={section.height_um} disabled={disabled}
          onChange={(v) => set({ height_um: v })} />
        <NumberField label="銅厚（µm）" value={section.thickness_um} disabled={disabled}
          onChange={(v) => set({ thickness_um: v })} />
        <NumberField
          label={lockedLengthReason ? "線長（mm）— 已鎖定" : "線長（mm）"}
          value={section.length_mm} step={0.1}
          disabled={disabled || Boolean(lockedLengthReason)}
          onChange={(v) => set({ length_mm: v })} />
      </div>
      {lockedLengthReason ? (
        <div className="finding info">
          <strong>［說明］{lockedLengthReason}</strong>
          <div className="detail">
            相減之後校正的對象是長短線的「差段」，不是任何一條原本的線。
            填成原本的線長會讓 Dk 差一個倍率——後端也會擋，但這裡先鎖住。
          </div>
        </div>
      ) : null}
    </section>
  );
}

function BandEditor({
  bands,
  onChange,
  disabled,
}: {
  bands: BandSpec[];
  onChange: (bands: BandSpec[]) => void;
  disabled: boolean;
}) {
  const update = (index: number, patch: Partial<BandSpec>) =>
    onChange(bands.map((band, i) => (i === index ? { ...band, ...patch } : band)));

  return (
    <section className="panel">
      <h2>校正區間</h2>
      <p className="hint">
        可以有很多段、不必連續，例如「低頻對損耗、高頻抓共振」。
        <strong>幅度與群延遲一律同時比對</strong>——只比幅度時 Dk 與 Df 無法分開，
        最佳化會回報一個曲線疊得很好但數字錯的答案。權重可調，但不能關掉其中一軌。
      </p>
      <div className="rows">
        {bands.map((band, index) => (
          <div className="row" key={index}>
            <NumberField label="起始（GHz）" value={band.f_start_ghz} step={0.1} disabled={disabled}
              onChange={(v) => update(index, { f_start_ghz: v })} />
            <NumberField label="結束（GHz）" value={band.f_stop_ghz} step={0.1} disabled={disabled}
              onChange={(v) => update(index, { f_stop_ghz: v })} />
            <label className="field">
              <span>響應項</span>
              <input value={band.entry} disabled={disabled}
                onChange={(event) => update(index, { entry: event.target.value.toUpperCase() })} />
            </label>
            <NumberField label="區間權重" value={band.weight} step={0.1} disabled={disabled}
              onChange={(v) => update(index, { weight: v })} />
            <NumberField label="幅度權重" value={band.weight_magnitude} step={0.05}
              disabled={disabled} onChange={(v) => update(index, { weight_magnitude: v })} />
            <NumberField label="群延遲權重" value={band.weight_group_delay} step={0.05}
              disabled={disabled} onChange={(v) => update(index, { weight_group_delay: v })} />
            <button className="ghost" disabled={disabled || bands.length === 1}
              onClick={() => onChange(bands.filter((_, i) => i !== index))}>
              刪除
            </button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <button className="ghost" disabled={disabled}
          onClick={() =>
            onChange([...bands, { f_start_ghz: 1, f_stop_ghz: 10, entry: "S11", weight: 0.5,
              weight_magnitude: 0.7, weight_group_delay: 0.3 }])
          }>
          新增區間
        </button>
      </div>
    </section>
  );
}

const PARAMETER_CHOICES = [
  { suffix: "dk_ref", label: "Dk（參考頻率下）", group: "material" },
  { suffix: "df_ref", label: "Df（參考頻率下）", group: "material" },
  { name: "line.roughness_rq_m", label: "銅箔粗糙度 Rq（m）" },
  { name: "line.width_m", label: "線寬（m）" },
  { name: "line.height_m", label: "介質厚度（m）" },
  { name: "line.thickness_m", label: "銅厚（m）" },
  { name: "line.length_m", label: "線長（m）" },
  { name: "line.conductivity", label: "導電率（S/m）" },
];

function ParameterEditor({
  parameters,
  onChange,
  disabled,
}: {
  parameters: ParameterSpec[];
  onChange: (parameters: ParameterSpec[]) => void;
  disabled: boolean;
}) {
  const update = (index: number, patch: Partial<ParameterSpec>) =>
    onChange(parameters.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  return (
    <section className="panel">
      <h2>校正參數</h2>
      <p className="hint">
        參數按<strong>材料</strong>分組，不按層——同一種 Prepreg 用在八個層上時它是一個
        參數。Dk 與 Df 綁成一組因果色散模型（Djordjevic-Sarkar），不是兩個獨立常數；
        當成獨立常數擬合會得到不因果的模型，時域會出現前導振鈴。
        參數選太多會讓它們彼此無法分辨，執行後的可辨識性分析會告訴你哪幾個定不出來。
      </p>
      <div className="rows">
        {parameters.map((parameter, index) => (
          <div className="row param" key={index}>
            <label className="field">
              <span>參數</span>
              <input value={parameter.name} disabled={disabled}
                onChange={(event) => update(index, { name: event.target.value })} />
            </label>
            <NumberField label="起始值" value={parameter.value} disabled={disabled}
              onChange={(v) => update(index, { value: v })} />
            <NumberField label="下界" value={parameter.lower} disabled={disabled}
              onChange={(v) => update(index, { lower: v })} />
            <NumberField label="上界" value={parameter.upper} disabled={disabled}
              onChange={(v) => update(index, { upper: v })} />
            <button className="ghost" disabled={disabled || parameters.length === 1}
              onClick={() => onChange(parameters.filter((_, i) => i !== index))}>
              刪除
            </button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {PARAMETER_CHOICES.filter((choice) => choice.name).map((choice) => (
          <button key={choice.name} className="ghost" disabled={disabled}
            onClick={() =>
              onChange([...parameters, {
                name: choice.name!, value: 1e-7, lower: 0, upper: 1e-6, group: "line",
              }])
            }>
            ＋ {choice.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function ResultPane({ result, jobId }: { result: CalibrationResult; jobId: string }) {
  // 三態，不是兩態。「殘差有系統性誤差」與「某個參數定不出來」是兩件不同的
  // 事——塌縮成一個「不可信」會讓使用者把好的參數一起丟掉。實測過：殘差乾淨、
  // Dk 誤差 3.7%、Df 誤差 2.9%，只有粗糙度定不出來。
  const unidentifiable =
    result.identifiability?.parameters.filter((p) => !p.identifiable) ?? [];

  return (
    <>
      <section className="panel">
        <h2>結果</h2>
        <VerdictCard
          conclusion={result.conclusion}
          warnings={result.warnings}
        />

        <table>
          <thead>
            <tr>
              <th>參數</th>
              <th>校正後的值</th>
              <th>可信範圍</th>
              {result.cross_validation?.converged ? <th>第二個模型</th> : null}
            </tr>
          </thead>
          <tbody>
            {Object.entries(result.parameters).map(([name, value]) => {
              const info = result.identifiability?.parameters.find((p) => p.name === name);
              const shift = result.cross_validation?.shifts.find((s) => s.name === name);
              const flagged = (info && !info.identifiable) || (shift && !shift.consistent);
              return (
                <tr key={name} className={flagged ? "unidentifiable" : ""}>
                  <td>{name}</td>
                  <td className="num">{value.toPrecision(6)}</td>
                  <td>
                    {info
                      ? `${info.lower.toPrecision(6)} – ${info.upper.toPrecision(6)}${
                          info.identifiable ? "" : "（定不出來）"
                        }`
                      : "—"}
                  </td>
                  {result.cross_validation?.converged ? (
                    <td>
                      {shift
                        ? `${shift.secondary.toPrecision(6)}（差 ${(
                            shift.relative * 100
                          ).toFixed(1)}%）${shift.consistent ? "" : " ← 不同意"}`
                        : "—"}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>

        {result.cross_validation ? (
          <div
            className={`finding ${
              !result.cross_validation.converged
                ? "warn"
                : result.cross_validation.all_consistent
                  ? "info"
                  : "block"
            }`}
            style={{ marginTop: 14 }}
          >
            <strong>
              交叉驗證：{result.cross_validation.primary_solver} →{" "}
              {result.cross_validation.secondary_solver}（
              {result.cross_validation.n_solves} 次求解）
            </strong>
            <div className="detail">
              {!result.cross_validation.converged ? (
                <>
                  第二個模型的重擬合用完預算就停了，<strong>這次的比較不算數</strong>。
                  這不代表兩個模型不合，是沒有驗成。
                </>
              ) : result.cross_validation.all_consistent ? (
                <>
                  兩個模型給出同一組參數。<strong>這不是模型正確的保證</strong>
                  ——兩者共同的假設（均勻線、同一套疊構、不含過孔）如果錯了，
                  它們會一起錯而且一致地錯，參數差還是會很小。交叉驗證只看得到
                  兩者<em>不同</em>的部分。
                </>
              ) : (
                <>
                  {result.cross_validation.shifts
                    .filter((s) => !s.consistent)
                    .map((s) => s.name)
                    .join("、")}
                  {" "}在兩個模型之間差得比可用範圍還大。至少有一個模型不適用於
                  這個結構，而殘差看不出來是哪一個——模型偏差會被吸收進參數，
                  所以曲線照樣疊得漂亮。這些參數不可採用。
                </>
              )}
            </div>
          </div>
        ) : null}

        <div className="downloads">
          <a href={reportUrl(jobId)} target="_blank" rel="noreferrer">校正報告（HTML）</a>
          <a href={materialsUrl(jobId)} target="_blank" rel="noreferrer">材料庫（JSON）</a>
          <a href={tableUrl(jobId)} target="_blank" rel="noreferrer">Dk／Df 頻率表（CSV）</a>
        </div>
      </section>

      <section className="panel">
        <h2>殘差診斷</h2>
        <p className="hint">
          殘差的<strong>形狀</strong>比大小重要：與頻率無關的固定偏移不可能來自材料，
          那是治具；正比於 f 是介電損耗；正比於 √f 是導體損耗與粗糙度。
        </p>
        <div className={`finding ${result.diagnosis.trustworthy ? "info" : "block"}`}>
          <strong>{result.diagnosis.message}</strong>
          <div className="detail">
            殘差 RMS {result.diagnosis.rms_db.toFixed(4)} dB
          </div>
        </div>
        {Object.keys(result.diagnosis.contribution).length > 0 ? (
          <table>
            <thead>
              <tr><th>成分</th><th>RMS 貢獻（dB）</th></tr>
            </thead>
            <tbody>
              {Object.entries(result.diagnosis.contribution).map(([name, value]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="num">{value.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section className="panel">
        <h2>求解統計</h2>
        <table>
          <tbody>
            <tr><th>真求解次數</th><td className="num">{result.n_solves}</td></tr>
            <tr><th>沿用既有資料點</th><td className="num">{result.n_reused}</td></tr>
            <tr>
              <th>代理模型</th>
              <td className="num">
                {result.surrogate_model}（CoP {result.cop.toFixed(3)}）
              </td>
            </tr>
            <tr><th>校正前成本</th><td className="num">{result.initial_cost.toPrecision(4)}</td></tr>
            <tr><th>校正後成本</th><td className="num">{result.final_cost.toPrecision(4)}</td></tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
