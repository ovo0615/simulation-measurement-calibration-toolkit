// 差動面板的渲染測試。
//
// 要守的是兩件「錯了畫面也不會報錯」的事：二埠量測時面板不該出現（否則單端
// 使用者會以為要先轉差模），以及 P370 擋下時不能長出覆寫欄位。

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DifferentialInfo, UploadInfo } from "./api";
import { DeltaLPanel } from "./DeltaLPanel";
import { DifferentialPanel } from "./DifferentialPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function upload(nPort: number): UploadInfo {
  return {
    token: "measured:pair.s4p",
    label: "pair.s4p",
    n_port: nPort,
    z_ref: 50,
    f_start_ghz: 0.05,
    f_stop_ghz: 20,
    n_points: 401,
    port_names: ["P1", "P2", "P3", "P4"].slice(0, nPort),
  };
}

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe("DifferentialPanel", () => {
  it("二埠量測時不出現", () => {
    const { container } = render(
      <DifferentialPanel measured={upload(2)} differential={null} onPrepared={() => {}}
        disabled={false} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("P370 擋下時列出原因，而且沒有覆寫欄位", async () => {
    respond(409, {
      detail: {
        reason: "differential_quality",
        overridable: false,
        findings: [
          { severity: "block", code: "p370_dd_causality", message: "P370 差模因果性：差（42.0%）" },
        ],
      },
    });
    const onPrepared = vi.fn();
    render(
      <DifferentialPanel measured={upload(4)} differential={null} onPrepared={onPrepared}
        disabled={false} />,
    );
    fireEvent.click(screen.getByText("P370 檢查並轉成差模"));

    await waitFor(() => expect(screen.getByTestId("differential-blocked")).toBeDefined());
    expect(screen.getByText("P370 差模因果性：差（42.0%）", { exact: false })).toBeDefined();
    expect(screen.queryByPlaceholderText("輸入：我了解")).toBeNull();
    expect(onPrepared).not.toHaveBeenCalledWith(expect.objectContaining({ token: expect.anything() }));
  });

  it("通過時把差模資訊交給上層", async () => {
    const info: DifferentialInfo = {
      ...upload(2),
      token: "differential:measured:pair.s4p|13_24",
      label: "pair.s4p（差模）",
      z_ref: 100,
      port_names: ["D1", "D2"],
      port_order: "13_24",
      port_order_label: "埠 1、2 在近端（1→3、2→4 同一條線）",
      mode_conversion_db: -45.2,
      findings: [],
    };
    respond(200, info);
    const onPrepared = vi.fn();
    render(
      <DifferentialPanel measured={upload(4)} differential={null} onPrepared={onPrepared}
        disabled={false} />,
    );
    fireEvent.click(screen.getByText("P370 檢查並轉成差模"));

    await waitFor(() => expect(onPrepared).toHaveBeenLastCalledWith(info));
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toEqual({ token: "measured:pair.s4p", port_order: "13_24" });
  });
});

describe("DeltaLPanel（差動）", () => {
  it("第二片用同一個埠序先過 P370，被擋時列出原因", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.startsWith("/api/upload"))
          return new Response(JSON.stringify({ ...upload(4), token: "measured:short.s4p" }));
        return new Response(
          JSON.stringify({
            detail: {
              reason: "differential_quality",
              overridable: false,
              findings: [
                { severity: "block", code: "p370_dd_passivity", message: "P370 差模被動性：差（12.0%）" },
              ],
            },
          }),
          { status: 409 },
        );
      }),
    );
    const { container } = render(
      <DeltaLPanel primary={upload(2)} portOrder="12_34" extraction={null}
        onExtracted={() => {}} disabled={false} />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "short.s4p")] } });

    await waitFor(() =>
      expect(screen.getByText("P370 差模被動性：差（12.0%）", { exact: false })).toBeDefined(),
    );
    expect(calls).toEqual(["/api/upload?origin=measured", "/api/differential"]);
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body);
    expect(body).toEqual({ token: "measured:short.s4p", port_order: "12_34" });
    expect(screen.queryByPlaceholderText("輸入：我了解")).toBeNull();
  });
});
