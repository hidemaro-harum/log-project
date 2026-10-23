import assert from "node:assert/strict";
import test from "node:test";
import { formatShortDate, getLocalDateInputValue } from "./display-format.ts";

test("date inputs use the local day and date-only visits never shift across timezones", (context) => {
  const previous = process.env.TZ;
  context.after(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });
  process.env.TZ = "Asia/Tokyo";
  assert.equal(
    getLocalDateInputValue(new Date("2026-10-03T16:00:00Z")),
    "2026-10-04",
  );
  process.env.TZ = "America/Los_Angeles";
  assert.equal(
    getLocalDateInputValue(new Date("2026-10-04T02:00:00Z")),
    "2026-10-03",
  );
  assert.equal(formatShortDate("2026-10-04"), "10月4日");
  assert.equal(formatShortDate("not-a-date"), "not-a-date");
});
