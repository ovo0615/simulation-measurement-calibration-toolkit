// 目錄瀏覽選取器：讓使用者用點的選 .aedb（或選一個輸出資料夾）。
// 目錄清單由後端提供；為什麼不能用瀏覽器的檔案選擇器、為什麼一定要有這個，
// 完整理由寫在 backend/app/layout/browse.py 的模組說明裡，不在這裡重複。

import { useCallback, useEffect, useState } from "react";
import { layoutBrowse } from "./api";
import type { BrowseResult } from "./api";

export function PathPicker({
  open,
  initialPath,
  onPick,
  onClose,
  // "edb" 選一個既有的 .aedb；"folder" 選一個資料夾（輸出路徑用，
  // 那個 .aedb 還不存在，所以只能選它的上層）。
  mode = "edb",
}: {
  open: boolean;
  initialPath: string;
  onPick: (path: string) => void;
  onClose: () => void;
  mode?: "edb" | "folder";
}) {
  const [listing, setListing] = useState<BrowseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const go = useCallback(async (path: string) => {
    setBusy(true);
    setError("");
    try {
      setListing(await layoutBrowse(path));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (open) go(initialPath);
  }, [open, initialPath, go]);

  if (!open) return null;

  const entries = listing?.entries ?? [];
  const boards = entries.filter((e) => e.is_edb);
  const folders = entries.filter((e) => !e.is_edb);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <strong>選擇 .aedb 目錄</strong>
          <button className="ghost" onClick={onClose}>
            關閉
          </button>
        </div>

        <div className="modal-path">
          <button
            className="ghost"
            disabled={busy || listing?.parent === null}
            onClick={() => go(listing?.parent ?? "")}
          >
            ↑ 上一層
          </button>
          <code>{listing?.path || "（磁碟機）"}</code>
          {mode === "folder" && listing?.path ? (
            <button className="primary" onClick={() => onPick(listing.path)}>
              選這個資料夾
            </button>
          ) : null}
        </div>

        {error ? <div className="error">{error}</div> : null}
        {listing?.error ? <div className="error">{listing.error}</div> : null}

        <div className="modal-list">
          {busy ? <div className="modal-empty">讀取中…</div> : null}
          {!busy && entries.length === 0 ? (
            <div className="modal-empty">這個資料夾底下沒有子目錄。</div>
          ) : null}

          {/* .aedb 排在最前面並標出來——使用者是來找它的 */}
          {boards.map((entry) => (
            <div
              key={entry.path}
              className="modal-row is-edb"
              onClick={() => (mode === "folder" && !busy ? go(entry.path) : null)}
            >
              <span className="modal-name">📁 {entry.name}</span>
              <span className="modal-tag">EDB</span>
              {mode === "edb" ? (
                <button className="primary" onClick={() => onPick(entry.path)}>
                  選這個
                </button>
              ) : null}
            </div>
          ))}

          {folders.map((entry) => (
            <div
              key={entry.path}
              className="modal-row"
              onClick={() => (busy ? null : go(entry.path))}
            >
              <span className="modal-name">📂 {entry.name}</span>
            </div>
          ))}
        </div>

        {listing?.truncated ? (
          <div className="modal-note">
            項目太多，只列出前面一部分。可以直接在欄位裡貼上路徑再開啟這個視窗。
          </div>
        ) : null}
        <div className="modal-note">
          {mode === "edb" ? (
            <>
              標了 <strong>EDB</strong> 的才是可以選的版面目錄（裡面有 edb.def）。
              其餘的點一下進入下一層。
            </>
          ) : (
            <>
              點資料夾進入下一層，找到要放輸出的位置後按「選這個資料夾」。
              裁切的 .aedb 會建立在那底下。
            </>
          )}
        </div>
      </div>
    </div>
  );
}
