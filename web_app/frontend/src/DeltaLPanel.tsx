// Delta-L 面板：長短線相減，把治具消掉。
//
// 介面上刻意強調兩件事，因為它們都是「錯了也不會有任何徵兆」的類型：
//
//   1. 誰是長線由**群延遲**決定，不由檔名決定。
//   2. 長度必須確認。填錯不會讓任何曲線看起來不對，只會讓 Dk 錯上百倍。

import { useCallback, useState } from "react";
import { detectDeltaL, extractDeltaL, upload } from "./api";
import type { DeltaLCandidate, DeltaLExtraction, Finding, UploadInfo } from "./api";
import { FileDrop, Findings, NumberField } from "./components";

export function DeltaLPanel({
  primary,
  extraction,
  onExtracted,
  disabled,
}: {
  primary: UploadInfo | null;
  extraction: DeltaLExtraction | null;
  onExtracted: (extraction: DeltaLExtraction | null) => void;
  disabled: boolean;
}) {
  const [enabled, setEnabled] = useState(false);
  const [secondary, setSecondary] = useState<UploadInfo | null>(null);
  const [candidate, setCandidate] = useState<DeltaLCandidate | null>(null);
  const [noPair, setNoPair] = useState<Finding | null>(null);
  const [lengths, setLengths] = useState({ short: 0, long: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const detect = useCallback(
    async (other: UploadInfo) => {
      if (!primary) return;
      setError("");
      setNoPair(null);
      onExtracted(null);
      try {
        const found = await detectDeltaL([primary.token, other.token]);
        const best = found.candidates[0] ?? null;
        setCandidate(best);
        // 找不到配對時**一定要說原因**。先前這裡什麼都不做，畫面就完全沒有
        // 動靜——實測時使用者把同一個檔案載入兩次，面板靜默，看不出哪裡錯。
        setNoPair(best ? null : found.reason ?? null);
        if (best) {
          setLengths({
            short: best.suggested_length_short_mm ?? 0,
            long: best.suggested_length_long_mm ?? 0,
          });
        }
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : String(exc));
      }
    },
    [primary, onExtracted],
  );

  const subtract = useCallback(async () => {
    if (!candidate) return;
    setBusy(true);
    setError("");
    try {
      onExtracted(
        await extractDeltaL({
          short: candidate.short_token,
          long: candidate.long_token,
          length_short_mm: lengths.short,
          length_long_mm: lengths.long,
        }),
      );
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
      onExtracted(null);
    } finally {
      setBusy(false);
    }
  }, [candidate, lengths, onExtracted]);

  return (
    <section className="panel">
      <h2>Delta-L（長短線相減）</h2>
      <p className="hint">
        量測一對<strong>同截面、不同長度</strong>的試片，相除之後治具與接頭的貢獻
        自動消失——不需要去嵌演算法，只要治具在兩片試片上一樣。這是治具汙染問題的
        正解：同一份含 0.6 dB 接頭損耗的資料，直接校正會讓 Df 偏高約 19%，
        走 Delta-L 則回到真值的 1% 以內。
      </p>

      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
        <input
          type="checkbox"
          style={{ width: "auto" }}
          checked={enabled}
          disabled={disabled || !primary}
          onChange={(event) => {
            setEnabled(event.target.checked);
            if (!event.target.checked) {
              setCandidate(null);
              setNoPair(null);
              setSecondary(null);
              onExtracted(null);
            }
          }}
        />
        <span>
          使用 Delta-L（需要第二片試片的量測）
          {primary ? "" : " — 請先載入第一片試片"}
        </span>
      </label>

      {enabled ? (
        <>
          <FileDrop
            title="另一片試片"
            hint="點擊或拖放另一個長度的量測"
            info={secondary}
            busy={false}
            onFile={async (file) => {
              setError("");
              try {
                const info = await upload(file, "measured");
                setSecondary(info);
                await detect(info);
              } catch (exc) {
                setError(exc instanceof Error ? exc.message : String(exc));
              }
            }}
          />

          {error ? <div className="error">{error}</div> : null}

          {noPair ? <Findings findings={[noPair]} /> : null}

          {candidate ? (
            <>
              <table style={{ marginTop: 16 }}>
                <tbody>
                  <tr>
                    <th>短線</th>
                    <td>{candidate.short_label}</td>
                  </tr>
                  <tr>
                    <th>長線</th>
                    <td>{candidate.long_label}</td>
                  </tr>
                  <tr>
                    <th>群延遲差</th>
                    <td className="num">
                      {candidate.delay_difference_ps === null
                        ? "無法計算"
                        : `${candidate.delay_difference_ps.toFixed(2)} ps`}
                      {candidate.delay_flatness === null
                        ? ""
                        : `（隨頻率變化 ${(100 * candidate.delay_flatness).toFixed(1)}%）`}
                    </td>
                  </tr>
                  <tr>
                    <th>治具殘留</th>
                    <td className="num">
                      {candidate.fixture_residue_db === null
                        ? "無法計算"
                        : `${candidate.fixture_residue_db.toFixed(3)} dB`}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="hint" style={{ marginTop: 4 }}>
                誰是長線由<strong>群延遲</strong>決定，不由檔名決定。治具殘留是
                「損耗差外推到零頻」的截距——與頻率無關的損耗只能來自治具，
                兩片試片的治具若不同，相減就消不乾淨。
              </p>

              <Findings findings={candidate.findings} />

              {candidate.is_valid ? (
                <>
                  <p className="hint" style={{ marginTop: 16 }}>
                    以下長度<strong>從檔名猜出來，必須確認</strong>。長度填錯不會讓任何
                    曲線看起來不對，只會讓校正出的 Dk 錯上百倍——工具會用群延遲反推
                    有效介電常數來擋單位錯誤，但那只擋得住數量級的錯。
                  </p>
                  <div className="grid3">
                    <NumberField
                      label="短線長度（mm）"
                      value={lengths.short}
                      step={0.1}
                      disabled={disabled || busy}
                      onChange={(v) => setLengths({ ...lengths, short: v })}
                    />
                    <NumberField
                      label="長線長度（mm）"
                      value={lengths.long}
                      step={0.1}
                      disabled={disabled || busy}
                      onChange={(v) => setLengths({ ...lengths, long: v })}
                    />
                    <div style={{ alignSelf: "end", paddingBottom: 10 }}>
                      <button
                        className="primary"
                        disabled={disabled || busy || lengths.long <= lengths.short}
                        onClick={subtract}
                      >
                        {busy ? "相減中…" : "相減"}
                      </button>
                    </div>
                  </div>
                  {lengths.long <= lengths.short ? (
                    // 變灰的按鈕不說原因，等於沒有訊息。實測過：把長線長度
                    // 填成 3（英吋當公釐）時按鈕直接灰掉，使用者看不出為什麼。
                    <div className="finding warn">
                      <strong>［警告］長線長度必須大於短線長度</strong>
                      <div className="detail">
                        目前填的是短線 {lengths.short} mm、長線 {lengths.long} mm。
                        兩個欄位的單位都是公釐——若你手上的規格是英吋，1 吋 = 25.4 mm。
                      </div>
                    </div>
                  ) : (
                    null
                  )}
                </>
              ) : null}
            </>
          ) : null}

          {extraction ? (
            <>
              <div className="verdict ok" style={{ marginTop: 16 }}>
                <strong>相減完成，治具已消除</strong>
                校正的對象變成一段長度 {extraction.delta_length_mm.toFixed(3)} mm、
                兩端沒有治具的傳輸線。
              </div>
              <table>
                <tbody>
                  <tr>
                    <th>ΔL</th>
                    <td className="num">{extraction.delta_length_mm.toFixed(3)} mm</td>
                  </tr>
                  <tr>
                    <th>頻段</th>
                    <td className="num">
                      {extraction.f_start_ghz.toFixed(4)} – {extraction.f_stop_ghz.toFixed(4)} GHz
                      （{extraction.n_points} 點）
                    </td>
                  </tr>
                  <tr>
                    <th>損耗（{extraction.mid_frequency_ghz.toFixed(3)} GHz）</th>
                    <td className="num">{extraction.loss_db_per_m_at_mid.toFixed(3)} dB/m</td>
                  </tr>
                  <tr>
                    <th>有效介電常數</th>
                    <td className="num">{extraction.eps_eff_at_mid.toFixed(4)}</td>
                  </tr>
                </tbody>
              </table>
              <Findings findings={extraction.findings} />
              <p className="hint">
                相減同時消掉了反射資訊，所以這份資料<strong>只有 S21 有意義</strong>。
                校正區間若填 S11 會直接被擋下——不擋的話最佳化會去擬合一堆零，
                然後回報「完美收斂」。
              </p>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
