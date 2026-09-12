// 後端 API 的型別與呼叫。
//
// 錯誤處理刻意不吞：後端的錯誤訊息是寫給工程師看的（「頻率欄沒有標示單位」
// 「埠數不符」），把它換成「發生錯誤」等於把最有用的資訊丟掉。

export interface UploadInfo {
  token: string;
  label: string;
  n_port: number;
  z_ref: number;
  f_start_ghz: number;
  f_stop_ghz: number;
  n_points: number;
  port_names: string[];
}

export interface Finding {
  severity: "block" | "warn" | "info";
  code: string;
  message: string;
  detail?: string;
}

export interface ChartPair {
  entry: string;
  magnitude: string;
  group_delay: string;
}

export interface CompareResult {
  findings: Finding[];
  blocking: boolean;
  charts: ChartPair[];
  error?: string;
  summary?: {
    f_start_ghz: number;
    f_stop_ghz: number;
    n_points: number;
    rms_magnitude_db: number;
    rms_group_delay_ps: number;
  };
}

export interface BandSpec {
  f_start_ghz: number;
  f_stop_ghz: number;
  entry: string;
  weight: number;
  weight_magnitude: number;
  weight_group_delay: number;
}

export interface ParameterSpec {
  name: string;
  value: number;
  lower: number;
  upper: number;
  group?: string;
  unit?: string;
}

export interface SectionSpec {
  material_name: string;
  dk: number;
  df: number;
  f_ref_ghz: number;
  width_um: number;
  height_um: number;
  thickness_um: number;
  length_mm: number;
  roughness_um: number;
  geometry: "stripline" | "microstrip";
}

export interface IdentifiabilityParam {
  name: string;
  value: number;
  lower: number;
  upper: number;
  identifiable: boolean;
}

// 判定與語氣都是**封閉集合**，不是任意字串。
//
// 先前兩者都宣告成 string，於是拼錯字 TypeScript 不會攔，只會在執行時退回
// 最嚴重的樣式——而那個退路本來是給「後端加了新語氣」用的，不該同時掩護
// 打字錯誤。而且 verdict 在這裡與 CalibrationResult 各寫了一次，兩處會漂移。
export type Verdict = "trustworthy" | "partial" | "unverified" | "unreliable";
export type Tone = "good" | "caution" | "bad";

// 欄位名必須與後端 Conclusion.as_dict() 一致。
//
// 這個陣列存在的理由是**讓那件事可以被機器檢查**。後端的
// test_every_consumer_reads_the_same_conclusion 先前是用正規表示式去解析
// 下面那個 interface——依賴縮排與寫法，合法的排版調整就會誤報。改成解析
// 一個字串陣列，穩定得多；而 CONCLUSION_FIELDS 與 interface 有沒有同步，
// 由下面的 satisfies 交給 TypeScript 檢查。
export const CONCLUSION_FIELDS = [
  "verdict",
  "label",
  "tone",
  "headline",
  "reasons",
  "advice",
  "usable",
  "reports_usable",
] as const;

export interface Conclusion {
  verdict: Verdict;
  // 標籤由後端給。前端曾經自己有一份對照表，加狀態時漏改就會顯示空標籤。
  label: string;
  // tone 是語氣，不是 class 名稱——對應到哪個 class 由前端自己決定，
  // 見 VerdictCard.tsx。
  tone: Tone;
  headline: string;
  reasons: { code: string; text: string }[];
  advice: string[];
  usable: string[];
  // 這個判定會不會區分「哪些參數可以採用」。由後端決定——先前前端寫死
  // `verdict === "partial"`，日後多一種可部分採用的判定就要記得回來改。
  reports_usable: boolean;
}

// interface 的欄位與 CONCLUSION_FIELDS 必須完全一致。少一個或多一個都是
// 編譯錯誤，不必等到跑起來才發現。
type _FieldsMatch = [
  Exclude<keyof Conclusion, (typeof CONCLUSION_FIELDS)[number]>,
  Exclude<(typeof CONCLUSION_FIELDS)[number], keyof Conclusion>,
] extends [never, never]
  ? true
  : never;
const _fieldsMatch: _FieldsMatch = true;
void _fieldsMatch;

export interface CalibrationResult {
  // 與 Conclusion.verdict 是同一個狀態，用同一個型別，不要各寫一份。
  verdict: Verdict;
  usable_parameters: string[];
  parameters: Record<string, number>;
  initial_cost: number;
  final_cost: number;
  improvement: number;
  n_solves: number;
  n_reused: number;
  cop: number;
  surrogate_model: string;
  surrogate_cost: number;
  verification_cost: number;
  warnings: string[];
  diagnosis: {
    verdict: string;
    message: string;
    rms_db: number;
    offset_db: number;
    trustworthy: boolean;
    contribution: Record<string, number>;
  };
  identifiability: {
    condition_number: number;
    all_identifiable: boolean;
    parameters: IdentifiabilityParam[];
    flat_directions: { description: string; eigenvalue: number }[];
  } | null;
  conclusion: Conclusion;
  verification_incomplete: boolean;
  cross_validation: {
    primary_solver: string;
    secondary_solver: string;
    converged: boolean;
    all_consistent: boolean;
    n_solves: number;
    shifts: {
      name: string;
      primary: number;
      secondary: number;
      relative: number;
      consistent: boolean;
    }[];
  } | null;
  bands: {
    label: string;
    rms_magnitude_db: number;
    rms_group_delay_ps: number;
    n_points: number;
  }[];
}

export interface JobEvent {
  stage: string;
  done: number;
  total: number;
  message: string;
  at: string;
}

export interface JobStatus {
  id: string;
  kind: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  error: string;
  created_at: string;
  events: JobEvent[];
  result?: CalibrationResult;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly detail?: unknown) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let detail: unknown;
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      detail = body.detail ?? body;
      if (typeof detail === "string") message = detail;
      else if (detail && typeof detail === "object" && "reason" in detail)
        message = "前置檢查未通過";
    } catch {
      /* 回應不是 JSON，維持原本的狀態碼訊息 */
    }
    throw new ApiError(message, response.status, detail);
  }
  return (await response.json()) as T;
}

export async function upload(file: File, origin: "simulated" | "measured") {
  const form = new FormData();
  form.append("file", file);
  return request<UploadInfo>(`/api/upload?origin=${origin}`, {
    method: "POST",
    body: form,
  });
}

export async function compare(simulated: string, measured: string) {
  return request<CompareResult>("/api/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ simulated, measured }),
  });
}

export interface CalibrateBody {
  measured: string;
  section: SectionSpec;
  parameters: ParameterSpec[];
  bands: BandSpec[];
  n_samples?: number | null;
  refine_rounds?: number;
  polish_budget?: number;
  analyze_identifiability?: boolean;
  solver?: string;
  cross_solver?: string;
  cross_budget?: number;
  acknowledge_blocking?: string;
}

export async function startCalibration(body: CalibrateBody) {
  return request<{ job_id: string; findings: Finding[] }>("/api/calibrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function jobStatus(jobId: string) {
  return request<JobStatus>(`/api/jobs/${jobId}`);
}

export async function cancelJob(jobId: string) {
  return request<{ ok: boolean }>(`/api/jobs/${jobId}/cancel`, { method: "POST" });
}

export function watchJob(jobId: string, onEvent: (event: JobEvent) => void): () => void {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/jobs/${jobId}`;
  const socket = new WebSocket(url);
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data) as JobEvent;
    if (data.stage) onEvent(data);
  };
  return () => socket.close();
}

export interface DeltaLCandidate {
  short_token: string;
  long_token: string;
  short_label: string;
  long_label: string;
  delay_difference_ps: number | null;
  delay_flatness: number | null;
  fixture_residue_db: number | null;
  suggested_length_short_mm: number | null;
  suggested_length_long_mm: number | null;
  is_valid: boolean;
  findings: Finding[];
}

export interface DeltaLExtraction {
  token: string;
  label: string;
  delta_length_mm: number;
  f_start_ghz: number;
  f_stop_ghz: number;
  n_points: number;
  loss_db_per_m_at_mid: number;
  eps_eff_at_mid: number;
  mid_frequency_ghz: number;
  findings: Finding[];
}

export async function detectDeltaL(tokens: string[]) {
  // reason 只在找不到配對時出現，說明為什麼——空清單不能只是空清單，
  // 否則介面就只能什麼都不顯示。
  return request<{ reason: Finding | null; candidates: DeltaLCandidate[] }>(
    "/api/deltal/detect",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokens }),
    },
  );
}

export async function extractDeltaL(body: {
  short: string;
  long: string;
  length_short_mm: number;
  length_long_mm: number;
}) {
  return request<DeltaLExtraction>("/api/deltal/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface LayoutStatus {
  available: boolean;
  reason: string;
  versions: string[];
  open_boards: string[];
}

export interface LayoutNet {
  name: string;
  layers: string[];
  length_mm: number;
  width_um: number;
  segment_count: number;
  via_count: number;
  looks_like_coupon: boolean;
}

export interface LayoutCoupon {
  net_name: string;
  layer_name: string;
  is_usable: boolean;
  reference_layers: string[];
  section: SectionSpec;
  findings: Finding[];
}

export interface CutoutResult {
  output_path: string;
  signal_nets: string[];
  reference_nets: string[];
  expansion_mm: number;
  nets_before: number;
  nets_after: number;
  primitives_before: number;
  primitives_after: number;
  reduction: number;
  findings: Finding[];
}

export async function layoutStatus() {
  return request<LayoutStatus>("/api/layout/status");
}

export interface BrowseEntry {
  name: string;
  path: string;
  is_edb: boolean;
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  is_edb: boolean;
  selected?: string | null;
  truncated: boolean;
  entries: BrowseEntry[];
  error?: string;
}

export async function layoutBrowse(path: string) {
  return request<BrowseResult>(`/api/layout/browse?path=${encodeURIComponent(path)}`);
}

export async function layoutNets(path: string, minLengthMm = 2.0) {
  return request<{ nets: LayoutNet[] }>("/api/layout/nets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, min_length_mm: minLengthMm }),
  });
}

export async function layoutCoupon(path: string, net: string) {
  return request<LayoutCoupon>("/api/layout/coupon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, net }),
  });
}

export async function layoutCutout(body: {
  path: string;
  nets: string[];
  output_path: string;
  expansion_mm: number;
}) {
  return request<{ job_id: string }>("/api/layout/cutout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function cutoutJobStatus(jobId: string) {
  return request<{
    status: JobStatus["status"];
    error: string;
    result?: CutoutResult;
  }>(`/api/jobs/${jobId}`);
}

export interface SolverInfo {
  id: "analytic" | "q2d";
  name: string;
  available: boolean;
  reason: string;
  seconds_per_solve: number;
  notes: string;
}

export async function listSolvers() {
  return request<{ solvers: SolverInfo[] }>("/api/solvers");
}

export const reportUrl = (jobId: string) => `/api/jobs/${jobId}/report`;
export const materialsUrl = (jobId: string) => `/api/jobs/${jobId}/materials.json`;
export const tableUrl = (jobId: string) => `/api/jobs/${jobId}/dk_df_table.csv`;
