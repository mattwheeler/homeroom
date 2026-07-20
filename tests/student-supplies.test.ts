import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("student source-backed supplies experience", () => {
  it("shows attributed official lines and explicitly refuses generated additions", async () => {
    const source = await readFile(new URL("../app/components/student-supplies.tsx", import.meta.url), "utf8");
    expect(source).toContain("From your school’s official list");
    expect(source).toContain("Checking items here does not change the original school page");
    expect(source).toContain("item.quantity !== null");
    expect(source).not.toContain("list.sourceUrl");
    expect(source).toContain("StudentOutboundGuard");
    expect(source).toContain('item.kind === "group_label"');
    expect(source).toContain('item.kind === "separator"');
    expect(source).toContain('filter((item) => item.kind === "item")');
  });

  it("is a first-class student destination", async () => {
    const source = await readFile(new URL("../app/components/student-home.tsx", import.meta.url), "utf8");
    expect(source).toContain('id: "supplies"');
    expect(source).toContain("<StudentSupplies");
  });
});
