// 判定卡的渲染測試。
//
// 這些測試補的是一個**具名的、先前補不了的缺口**。後端的
// test_every_consumer_reads_the_same_conclusion 只能讀 App.tsx 搜字串，
// 驗得到欄位改名與「前端偷偷長回自己的文案」，但驗不到：
//
//   JSX 接錯位置（把 headline 畫在 label 的位置）
//   放在走不到的分支（partial 才顯示的東西寫在 trustworthy 分支裡）
//   樣式套錯（caution 套成 ok 的綠色）
//
// 那三種要真的把元件渲染起來才看得到，所以這個專案裝了 vitest。

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Conclusion, Tone } from "./api";
import { VerdictCard } from "./VerdictCard";

function conclusion(overrides: Partial<Conclusion> = {}): Conclusion {
  return {
    verdict: "partial",
    label: "部分可用",
    tone: "caution",
    headline: "殘差沒有系統性誤差，但這組量測撐不起所有參數。",
    reasons: [{ code: "unidentifiable", text: "line.roughness_rq_m 無法由這組量測決定" }],
    advice: ["把頻段加寬，或把它固定成已知值再重跑。"],
    usable: ["FR4.dk_ref", "FR4.df_ref"],
    reports_usable: true,
    ...overrides,
  };
}

// 每一個測試之後把 DOM 清掉。
//
// @testing-library/react 會在偵測到全域 afterEach 時自動做這件事，也就是說
// 它其實依賴 vitest 的 globals。審查說 globals「未被使用」，我照著拿掉，
// 結果第二個 render 疊在第一個上面，getByTestId 抓到兩個元素——那個設定
// 有在用，只是用的方式是隱式的。
//
// 改成明確呼叫 cleanup 而不是把 globals 加回去：依賴一個看不見的全域鉤子
// 本來就不好，出事時（像這次）也很難從症狀聯想到設定。
afterEach(cleanup);

describe("VerdictCard", () => {
  it("把後端給的每一段都畫出來", () => {
    const c = conclusion();
    render(<VerdictCard conclusion={c} warnings={["AEDT 沒有放乾淨"]} />);

    expect(screen.getByText(c.label)).toBeDefined();
    expect(screen.getByText(c.headline, { exact: false })).toBeDefined();
    expect(screen.getByText(c.reasons[0].text)).toBeDefined();
    expect(screen.getByText(c.advice[0])).toBeDefined();
    expect(screen.getByText("AEDT 沒有放乾淨")).toBeDefined();
  });

  it("label 畫在 strong 裡，headline 不是", () => {
    // 防的是「接錯位置」：兩個都是字串，接反了畫面看起來只是怪，不會報錯。
    const c = conclusion();
    const { container } = render(<VerdictCard conclusion={c} warnings={[]} />);

    const strong = container.querySelector("strong");
    expect(strong?.textContent).toBe(c.label);
    expect(strong?.textContent).not.toBe(c.headline);
  });

  it("每一條原因都有自己的一列，不是接成一串", () => {
    const c = conclusion({
      reasons: [
        { code: "unidentifiable", text: "第一條原因" },
        { code: "model_disagreement", text: "第二條原因" },
      ],
    });
    render(<VerdictCard conclusion={c} warnings={[]} />);

    const items = screen.getByTestId("verdict-reasons").querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("第一條原因");
    expect(items[1].textContent).toBe("第二條原因");
  });

  it("兩種原因並存時兩份建議都要畫出來", () => {
    // 這正是報告曾經漏掉一半的那個情形（if/else 只選了一支）。
    const c = conclusion({
      reasons: [
        { code: "unidentifiable", text: "粗糙度定不出來" },
        { code: "model_disagreement", text: "Df 兩個模型差 60%" },
      ],
      advice: ["把頻段加寬。", "確認兩個模型的疊構與幾何輸入完全相同。"],
    });
    render(<VerdictCard conclusion={c} warnings={[]} />);

    expect(screen.getByText("把頻段加寬。")).toBeDefined();
    expect(screen.getByText("確認兩個模型的疊構與幾何輸入完全相同。")).toBeDefined();
  });

  describe("語氣對應到樣式", () => {
    const cases: [Tone, string][] = [
      ["good", "ok"],
      ["caution", "partial"],
      ["bad", "bad"],
    ];

    it.each(cases)("語氣 %s 套用 class %s", (tone, expected) => {
      const { container } = render(
        <VerdictCard conclusion={conclusion({ tone })} warnings={[]} />,
      );
      const card = container.querySelector(".verdict");
      expect(card?.className).toBe(`verdict ${expected}`);
    });

    it("未知的語氣往最嚴重的那邊倒", () => {
      // 後端加了新語氣而前端還沒跟上時，寧可畫得太嚴重，也不要是一片沒有
      // 樣式的白色——那看起來像「沒有問題」。
      //
      // 這裡要**刻意繞過型別**。Tone 現在是封閉集合，TypeScript 不讓你寫一
      // 個不在裡面的值——那正是要的行為。但這個退路防的就是「後端送來一個
      // 前端型別還不知道的值」，那是編譯期看不到、只會在執行期發生的事，
      // 所以測試必須造得出那個情形。
      const unknownTone = "something_new" as Tone;
      const { container } = render(
        <VerdictCard conclusion={conclusion({ tone: unknownTone })} warnings={[]} />,
      );
      expect(container.querySelector(".verdict")?.className).toBe("verdict bad");
    });
  });

  describe("只在該出現的時候出現", () => {
    it("後端說要列可採用清單時就列", () => {
      render(<VerdictCard conclusion={conclusion({ reports_usable: true })} warnings={[]} />);
      expect(screen.getByTestId("verdict-usable").textContent).toContain("FR4.dk_ref");
    });

    it("後端說不列的時候就不列", () => {
      // 防的是「放在走不到的分支」的反面：畫在不該畫的分支裡。
      //
      // 判準是後端給的 reports_usable，**不是**前端自己看 verdict 是不是
      // "partial"——日後多一種可部分採用的判定時，前端不必跟著改。
      render(
        <VerdictCard
          conclusion={conclusion({
            verdict: "trustworthy",
            tone: "good",
            reports_usable: false,
          })}
          warnings={[]}
        />,
      );
      expect(screen.queryByTestId("verdict-usable")).toBeNull();
    });

    it("判定不是 partial 但後端說要列，照樣要列", () => {
      // 這一項直接釘住「不要自己看 verdict」：如果前端偷偷寫回
      // verdict === "partial"，這裡就會紅。
      render(
        <VerdictCard
          conclusion={conclusion({ verdict: "unverified", reports_usable: true })}
          warnings={[]}
        />,
      );
      expect(screen.getByTestId("verdict-usable")).toBeDefined();
    });

    it("沒有原因時不畫空的清單", () => {
      render(<VerdictCard conclusion={conclusion({ reasons: [] })} warnings={[]} />);
      expect(screen.queryByTestId("verdict-reasons")).toBeNull();
    });

    it("沒有警告時不畫空的清單", () => {
      render(<VerdictCard conclusion={conclusion()} warnings={[]} />);
      expect(screen.queryByTestId("verdict-warnings")).toBeNull();
    });

    it("可採用清單是空的時候寫「（無）」而不是留白", () => {
      render(
        <VerdictCard
          conclusion={conclusion({ usable: [], reports_usable: true })}
          warnings={[]}
        />,
      );
      expect(screen.getByTestId("verdict-usable").textContent).toContain("（無）");
    });
  });
});
