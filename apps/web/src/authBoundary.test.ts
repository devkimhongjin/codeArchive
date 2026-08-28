import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceFiles = ["authClient.ts", "App.tsx", "extensionConnection.ts"];

function sourceText(): string {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  return sourceFiles.map((name) => readFileSync(`${dir}/${name}`, "utf8")).join("\n");
}

describe("Dashboard auth/source-transfer boundary", () => {
  it("contains no browser-storage token path or exchange flow", () => {
    const source = sourceText();
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|\/auth\/exchange/i);
  });

  it("does not emit source-bearing bridge requests from the auth-only Web slice", () => {
    const source = sourceText();
    expect(source).not.toMatch(/CODEARCHIVE_SYNC_SESSION_START|CODEARCHIVE_IMPORT_BEGIN|CODEARCHIVE_CAPTURE_PAGE|CODEARCHIVE_CAPTURE_ACK/);
  });
});
