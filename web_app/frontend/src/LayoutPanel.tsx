// 從 ODB++／EDB 版面讀出截面。
//
// 在此之前使用者要自己把線寬、板厚、線長、Dk、Df 打進去。那些數字版面裡全都
// 有，而且人工抄寫打錯不會有任何徵兆——曲線照樣疊得上去，只是答案錯了。
//
// 這個面板需要本機安裝 AEDT。沒有的機器上它會說清楚原因，其餘功能不受影響。

import { useCallback, useEffect, useState } from "react";
import {
  cutoutJobStatus,
  layoutCoupon,
  layoutCutout,
  layoutNets,
  layoutStatus,
} from "./api";
import type {
  CutoutResult,
  LayoutCoupon,
  LayoutNet,
  LayoutStatus,
  SectionSpec,
} from "./api";
import { Findings, NumberField } from "./components";
import { PathPicker } from "./PathPicker";

export function LayoutPanel({
  onSection,
  disabled,
}: {
  onSection: (section: SectionSpec, netName: string) => void;
  disabled: boolean;
}) {
  const [status, setStatus] = useState<LayoutStatus | null>(null);
  const [path, setPath] = useState("");
  const [nets, setNets] = useState<LayoutNet[]>([]);
  const [coupon, setCoupon] = useState<LayoutCoupon | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const [outputPath, setOutputPath] = useState("");
  const [expansion, setExpansion] = useState(2.0);
  const [cutout, setCutout] = useState<CutoutResult | null>(null);
  const [picking, setPicking] = useState(false);
  // 輸出的 .aedb 還不存在，所以選的是它要放進去的**資料夾**，檔名沿用欄位裡的。
  const [pickingOut, setPickingOut] = useState(false);

  useEffect(() => {
    layoutStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const loadNets = useCallback(async () => {
    setBusy("nets");
    setError("");
    setCoupon(null);
    setCutout(null);
    try {
      const found = await layoutNets(path, 2.0);
      setNets(found.nets);
      if (!outputPath) setOutputPath(path.replace(/\.aedb\/?$/i, "") + "_coupon.aedb");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy("");
    }
  }, [path, outputPath]);

  const pick = useCallback(
    async (net: LayoutNet) => {
      setBusy("coupon");
      setError("");
      try {
        setCoupon(await layoutCoupon(path, net.name));
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : String(exc));
        setCoupon(null);
      } finally {
        setBusy("");
      }
    },
    [path],
  );

  const runCutout = useCallback(async () => {
    if (!coupon) return;
    setBusy("cutout");
    setError("");
    setCutout(null);
    try {
      const started = await layoutCutout({
        path,
        nets: [coupon.net_name],
        output_path: outputPath,
        expansion_mm: expansion,
      });
      for (;;) {
        const info = await cutoutJobStatus(started.job_id);
        if (info.status === "done") {
          setCutout(info.result ?? null);
          break;
        }
        if (info.status === "failed" || info.status === "cancelled") {
          setError(info.error || "裁切中止");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy("");
    }
  }, [coupon, path, outputPath, expansion]);

  if (status && !status.available) {
    return (
      <section className="panel">
        <h2>從版面讀取截面</h2>
        <div className="finding info">
          <strong>［說明］此功能不可用</strong>
          <div className="detail">{status.reason}</div>
        </div>
        <p className="hint">
          工具的其他全部功能不受影響——截面可以在下面手動填寫。
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>從版面讀取截面</h2>
      <p className="hint">
        線寬、板厚、線長、Dk、Df 這些版面裡全都有，不必人工抄。尤其是
        <strong>帶線的板厚 b 是兩個參考層之間的距離</strong>，不是疊構表上任何
        一層的厚度——這是手填最常填錯的一個值，而填錯不會有任何徵兆。
        {status?.versions.length ? `　（使用 AEDT ${status.versions[0]}）` : ""}
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <label className="field" style={{ flex: 1, marginBottom: 0 }}>
          <span>版面路徑（.aedb 目錄）</span>
          <input
            value={path}
            placeholder="按「瀏覽」選擇，或直接貼上路徑"
            disabled={disabled || busy !== ""}
            onChange={(event) => setPath(event.target.value)}
          />
        </label>
        <button
          className="ghost"
          disabled={disabled || busy !== ""}
          onClick={() => setPicking(true)}
        >
          瀏覽…
        </button>
        <button
          className="primary"
          disabled={disabled || busy !== "" || !path.trim()}
          onClick={loadNets}
        >
          {busy === "nets" ? "讀取中…" : "讀取網路"}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        直接貼上也可以——Windows 的「複製檔案位址」會連引號一起複製，工具會自動
        去掉。ODB++ 請先在 AEDT 裡匯入成 .aedb：轉檔的選項（單位、層對應）會影響
        後續每一個數字，那些選擇應該由人做，不該由工具替你選。
      </p>

      <PathPicker
        open={picking}
        initialPath={path}
        onClose={() => setPicking(false)}
        onPick={(picked) => {
          setPath(picked);
          setPicking(false);
        }}
      />

      <PathPicker
        open={pickingOut}
        mode="folder"
        initialPath={outputPath.replace(/[\\/][^\\/]*$/, "")}
        onClose={() => setPickingOut(false)}
        onPick={(folder) => {
          // 分隔符**兩種都要**。只寫 / 的話 Windows 的反斜線路徑會整條
          // 被當成檔名，組出來的輸出路徑是壞的。
          const name = outputPath.split(/[\\/]/).pop() || "coupon.aedb";
          setOutputPath(folder.replace(/[\\/]+$/, "") + "\\" + name);
          setPickingOut(false);
        }}
      />

      {error ? <div className="error">{error}</div> : null}

      {nets.length > 0 ? (
        <>
          <p className="hint" style={{ marginTop: 16 }}>
            共 {nets.length} 條有走線的網路，
            {nets.filter((n) => n.looks_like_coupon).length} 條像校正試片
            （單層、有長度、過孔不超過兩個）。點一列讀出它的截面。
          </p>
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>網路</th>
                  <th>層</th>
                  <th>線長（mm）</th>
                  <th>線寬（µm）</th>
                  <th>過孔</th>
                </tr>
              </thead>
              <tbody>
                {nets.slice(0, 60).map((net) => (
                  <tr
                    key={net.name}
                    onClick={() => (disabled || busy ? null : pick(net))}
                    style={{
                      cursor: disabled || busy ? "default" : "pointer",
                      background:
                        coupon?.net_name === net.name
                          ? "#eff6ff"
                          : net.looks_like_coupon
                            ? undefined
                            : "#f8fafc",
                      opacity: net.looks_like_coupon ? 1 : 0.6,
                    }}
                  >
                    <td>{net.name}</td>
                    <td>{net.layers.join("、")}</td>
                    <td className="num">{net.length_mm.toFixed(3)}</td>
                    <td className="num">{net.width_um.toFixed(2)}</td>
                    <td className="num">{net.via_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nets.length > 60 ? (
            <p className="hint">只列出前 60 條，其餘已依「像不像試片」排序在後。</p>
          ) : null}
        </>
      ) : null}

      {coupon ? (
        <>
          <h2 style={{ fontSize: 16, marginTop: 24 }}>{coupon.net_name}</h2>
          <table>
            <tbody>
              <tr>
                <th>層</th>
                <td>{coupon.layer_name}</td>
              </tr>
              <tr>
                <th>結構</th>
                <td>
                  {coupon.section.geometry}
                  {coupon.reference_layers.length
                    ? `（參考層 ${coupon.reference_layers.join("、")}）`
                    : ""}
                </td>
              </tr>
              <tr>
                <th>線長</th>
                <td className="num">{coupon.section.length_mm.toFixed(4)} mm</td>
              </tr>
              <tr>
                <th>線寬</th>
                <td className="num">{coupon.section.width_um.toFixed(2)} µm</td>
              </tr>
              <tr>
                <th>
                  {coupon.section.geometry === "stripline"
                    ? "板厚 b（兩參考層間距）"
                    : "介質厚度 h"}
                </th>
                <td className="num">{coupon.section.height_um.toFixed(2)} µm</td>
              </tr>
              <tr>
                <th>銅厚</th>
                <td className="num">{coupon.section.thickness_um.toFixed(2)} µm</td>
              </tr>
              <tr>
                <th>介質</th>
                <td className="num">
                  {coupon.section.material_name}：Dk {coupon.section.dk.toFixed(4)}、
                  Df {coupon.section.df.toFixed(5)}
                </td>
              </tr>
            </tbody>
          </table>

          <Findings findings={coupon.findings} />

          <div style={{ marginTop: 12 }}>
            <button
              className="primary"
              disabled={disabled || !coupon.is_usable}
              onClick={() => onSection(coupon.section, coupon.net_name)}
            >
              套用到截面
            </button>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            Dk 與 Df 是版面裡填的<strong>起始值</strong>，不是答案——校正要找的
            正是它們。粗糙度沒有帶進來：EDB 存的是 Hall-Huray 的節點半徑，本工具
            的解析模型用 Hammerstad 的 RMS 粗糙度，兩者是不同的模型，數值不能互換。
          </p>

          <h2 style={{ fontSize: 16, marginTop: 24 }}>裁切（選用）</h2>
          <p className="hint">
            裁出試片周圍的區域，寫成一個新的 .aedb。這個檔案<strong>不進校正流程
            </strong>——校正走的是解析截面求解器，只需要上面那幾個數字。裁切的產物
            是給你拿去 AEDT 裡跑 SIwave 或 HFSS 用的，例如把校正後的材料填回去，
            用高保真度驗證一次。
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <label className="field" style={{ flex: 1, marginBottom: 0 }}>
              <span>輸出路徑</span>
              <input
                value={outputPath}
                disabled={disabled || busy !== ""}
                onChange={(event) => setOutputPath(event.target.value)}
              />
            </label>
            <button
              className="ghost"
              disabled={disabled || busy !== ""}
              onClick={() => setPickingOut(true)}
            >
              瀏覽…
            </button>
            <div style={{ width: 160 }}>
              <NumberField
                label="擴張（mm）"
                value={expansion}
                step={0.5}
                disabled={disabled || busy !== ""}
                onChange={setExpansion}
              />
            </div>
            <button
              className="ghost"
              disabled={disabled || busy !== "" || !outputPath.trim()}
              onClick={runCutout}
              style={{ marginBottom: 10 }}
            >
              {busy === "cutout" ? "裁切中…" : "裁切"}
            </button>
          </div>

          {cutout ? (
            <>
              <table>
                <tbody>
                  <tr>
                    <th>輸出</th>
                    <td>{cutout.output_path}</td>
                  </tr>
                  <tr>
                    <th>參考網路</th>
                    <td>{cutout.reference_nets.join("、")}</td>
                  </tr>
                  <tr>
                    <th>網路</th>
                    <td className="num">
                      {cutout.nets_before} → {cutout.nets_after}
                    </td>
                  </tr>
                  <tr>
                    <th>圖元</th>
                    <td className="num">
                      {cutout.primitives_before} → {cutout.primitives_after}
                      （少了 {(100 * cutout.reduction).toFixed(1)}%）
                    </td>
                  </tr>
                </tbody>
              </table>
              <Findings findings={cutout.findings} />
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
