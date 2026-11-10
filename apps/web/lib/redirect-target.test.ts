import assert from "node:assert/strict";
import test from "node:test";

import { safeRedirectPath } from "./redirect-target";

test("post-login redirects preserve local paths, queries and fragments", () => {
  for (const target of ["/", "/account", "/practice/mock-exams?level=hsk-1#start", "/account?label=hello%20world"]) {
    assert.equal(safeRedirectPath(target), target);
  }
  assert.equal(safeRedirectPath(null), "/account");
});

test("post-login redirects reject external URLs and browser normalization bypasses", () => {
  const origin = "https://hsk.example";
  for (const target of [
    "https://outside.example",
    "javascript:alert(1)",
    "//outside.example",
    "///outside.example",
    "/\\outside.example",
    "/\t/outside.example",
    "/\n/outside.example",
    "/\r/outside.example",
    "/account\u0000",
    "account",
    "",
  ]) {
    const safe = safeRedirectPath(target);
    assert.equal(safe, "/account", JSON.stringify(target));
    assert.equal(new URL(safe, origin).origin, origin);
  }
});
