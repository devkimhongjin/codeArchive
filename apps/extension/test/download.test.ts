import assert from "node:assert/strict";
import test from "node:test";
import { MAX_DOWNLOAD_BYTES, textDownloadUrl } from "../src/download";

test("download data URLs are MV3-worker-safe UTF-8 and bounded", () => {
  const url = textDownloadUrl("한글\ncode");
  assert.ok(url?.startsWith("data:text/plain;charset=utf-8;base64,"));
  const encoded = url!.split(",", 2)[1]!;
  assert.equal(new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))), "한글\ncode");
  assert.equal(textDownloadUrl("x".repeat(MAX_DOWNLOAD_BYTES + 1)), null);
});
