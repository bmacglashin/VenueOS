import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { WebsiteInquirySummaryPanel } from "./website-inquiry-summary-panel";

describe("WebsiteInquirySummaryPanel", () => {
  it("renders summary status, short summary, and key facts for Mission Control", () => {
    const markup = renderToStaticMarkup(
      <WebsiteInquirySummaryPanel
        status="completed"
        shortSummary="October reception inquiry for 140 guests."
        keyFacts={["Event date: 2026-10-18", "Guest count: 140"]}
        confidence={0.91}
        generatedAt="2026-04-11T18:02:00.000Z"
      />
    );

    assert.match(markup, /AI summary/);
    assert.match(markup, /completed/);
    assert.match(markup, /Confidence 91%/);
    assert.match(markup, /October reception inquiry for 140 guests\./);
    assert.match(markup, /Event date: 2026-10-18/);
    assert.match(markup, /Guest count: 140/);
  });
});
