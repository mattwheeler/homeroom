import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountEntry } from "../app/components/account-entry";

describe("AccountEntry", () => {
  it("starts verified identity sign-in for separate student and guardian roles", () => {
    const html = renderToStaticMarkup(createElement(AccountEntry));

    expect(html).toContain("Who is using Homeroom?");
    expect(html).toContain("Sign in as Emily");
    expect(html).toContain("Sign in as Matt");
    expect(html).toContain("Choose a profile");
    expect(html).toContain("Google sign-in keeps student and guardian spaces separate");
    expect(html).toContain("OpenAI Build Week judge access");
    expect(html).toContain('aria-controls="build-week-judge-panel"');
    expect(html).not.toContain('href="/student"');
    expect(html).not.toContain('href="/guardian"');
  });
});
