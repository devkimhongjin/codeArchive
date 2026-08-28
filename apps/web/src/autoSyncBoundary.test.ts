import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const files = ["App.tsx", "autoSyncSession.ts", "extensionConnection.ts"];
const source = files.map((name) => readFileSync(`${dir}/${name}`, "utf8")).join("\n");

describe("auto-sync lifecycle-only boundary", () => {
  it("does not add source import, page, ACK, or Main API sync calls", () => {
    expect(source).not.toMatch(/CODEARCHIVE_IMPORT_BEGIN|CODEARCHIVE_CAPTURE_PAGE|CODEARCHIVE_CAPTURE_ACK/);
    expect(source).not.toMatch(/bulk-upsert|bulkUpsert|clientRecordId/);
  });

  it("does not persist session, capability, account, or OAuth material", () => {
    const lifecycleSource = readFileSync(`${dir}/autoSyncSession.ts`, "utf8");
    expect(lifecycleSource).not.toMatch(/sessionStorage|indexedDB|capability|oauth|token|userId|accountId/i);
  });
});
