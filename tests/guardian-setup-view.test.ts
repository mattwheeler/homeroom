import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GuardianSetupWorkspace } from "../app/components/guardian-setup";

describe("guardian setup workspace", () => {
  it("begins behind a guardian-only entry boundary", () => {
    const markup = renderToStaticMarkup(createElement(GuardianSetupWorkspace));

    expect(markup).toContain("Guardian workspace");
    expect(markup).toContain("Continue as Matt");
    expect(markup).toContain("Emily’s student experience cannot change these settings");
    expect(markup).not.toContain("Connect Google Classroom");
  });
});
