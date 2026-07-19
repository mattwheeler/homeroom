import { readdir, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StudentOutboundGuard } from "../app/components/student-outbound-guard";

describe("student outbound navigation security", () => {
  it.each(["blocked", "guardian_approval"] as const)(
    "renders a non-navigable guarded state for %s",
    (policy) => {
      const html = renderToStaticMarkup(createElement(StudentOutboundGuard, {
        policy,
        resourceLabel: "original assignment"
      }));

      expect(html).not.toContain("href=");
      expect(html).not.toContain("http");
      expect(html).toContain(policy === "blocked" ? "External links are blocked" : "Ask your guardian to open");
    }
  );

  it("keeps every student surface free of dynamic or external anchors", async () => {
    const components = new URL("../app/components/", import.meta.url);
    const audited = (await readdir(components))
      .filter((file) => /^student-.*\.tsx$/.test(file));
    audited.push("learning-workspace.tsx");
    for (const file of audited) {
      const source = await readFile(new URL(`../app/components/${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/<a\b/i);
      expect(source, file).not.toMatch(/target\s*=\s*["']_blank/i);
      expect(source, file).not.toMatch(/href\s*=\s*\{/i);
      expect(source, file).not.toMatch(/href\s*=\s*["']https?:/i);
    }
  });
});
