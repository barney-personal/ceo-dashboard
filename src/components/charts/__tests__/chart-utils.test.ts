import { describe, it, expect } from "vitest";
import { getContentBoxWidth } from "../chart-utils";

describe("getContentBoxWidth", () => {
  it("subtracts horizontal padding from clientWidth", () => {
    const div = document.createElement("div");
    // In jsdom, clientWidth is 0 by default, but we can override it
    Object.defineProperty(div, "clientWidth", { value: 800 });
    div.style.paddingLeft = "16px";
    div.style.paddingRight = "16px";
    document.body.appendChild(div);

    const width = getContentBoxWidth(div);
    expect(width).toBe(768); // 800 - 16 - 16

    document.body.removeChild(div);
  });

  it("returns clientWidth when there is no padding", () => {
    const div = document.createElement("div");
    Object.defineProperty(div, "clientWidth", { value: 600 });
    document.body.appendChild(div);

    const width = getContentBoxWidth(div);
    expect(width).toBe(600);

    document.body.removeChild(div);
  });

  it("handles asymmetric padding", () => {
    const div = document.createElement("div");
    Object.defineProperty(div, "clientWidth", { value: 1000 });
    div.style.paddingLeft = "24px";
    div.style.paddingRight = "40px";
    document.body.appendChild(div);

    const width = getContentBoxWidth(div);
    expect(width).toBe(936); // 1000 - 24 - 40

    document.body.removeChild(div);
  });
});
