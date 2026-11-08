import { describe, expect, it } from "vitest";
import { formatCnic, formatMobile } from "@/lib/forms/masks";

describe("formatCnic", () => {
  it("drops non-digits and auto-dashes 5-7-1", () => {
    expect(formatCnic("3")).toBe("3");
    expect(formatCnic("35202")).toBe("35202");
    expect(formatCnic("352021")).toBe("35202-1");
    expect(formatCnic("352021234567")).toBe("35202-1234567");
    expect(formatCnic("3520212345671")).toBe("35202-1234567-1");
  });
  it("blocks letters/symbols and caps at 13 digits", () => {
    expect(formatCnic("abc35202def1234567!1")).toBe("35202-1234567-1");
    expect(formatCnic("352021234567890")).toBe("35202-1234567-8");
  });
});

describe("formatMobile", () => {
  it("0-prefixed: digits only, max 11", () => {
    expect(formatMobile("0300")).toBe("0300");
    expect(formatMobile("03001234567")).toBe("03001234567");
    expect(formatMobile("0300123456789")).toBe("03001234567");
    expect(formatMobile("0300-123 4567")).toBe("03001234567");
    expect(formatMobile("abc0300xyz123")).toBe("0300123"); // only digits, in order
  });
  it("+92-prefixed: +92 then 10 national digits", () => {
    expect(formatMobile("+92")).toBe("+92");
    expect(formatMobile("+923001234567")).toBe("+923001234567");
    expect(formatMobile("+923001234567890")).toBe("+923001234567");
    expect(formatMobile("+3001234567")).toBe("+923001234567"); // forces 92 after +
  });
});
