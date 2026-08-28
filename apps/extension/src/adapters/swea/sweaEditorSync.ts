export type SweaEditorSyncResult =
  | { status: "synced" }
  | { status: "failed"; reason: "bridge_unavailable" | "editor_unavailable" | "save_failed" };

const SYNC_ATTRIBUTE = "data-codearchive-editor-sync";

export function syncSweaEditor(document: Document): SweaEditorSyncResult {
  const parent = document.documentElement ?? document.body;
  if (!parent) return { status: "failed", reason: "bridge_unavailable" };

  const bridge = document.createElement("button");
  bridge.type = "button";
  bridge.hidden = true;
  bridge.setAttribute(SYNC_ATTRIBUTE, "pending");
  bridge.setAttribute(
    "onclick",
    `try {
      if (typeof cEditor === "undefined" || !cEditor || typeof cEditor.save !== "function") {
        this.setAttribute("${SYNC_ATTRIBUTE}", "editor_unavailable");
      } else {
        cEditor.save();
        this.setAttribute("${SYNC_ATTRIBUTE}", "synced");
      }
    } catch (_) {
      this.setAttribute("${SYNC_ATTRIBUTE}", "save_failed");
    }
    return false;`,
  );

  try {
    parent.appendChild(bridge);
    bridge.click();

    const result = bridge.getAttribute(SYNC_ATTRIBUTE);
    if (result === "synced") return { status: "synced" };
    if (result === "editor_unavailable") return { status: "failed", reason: "editor_unavailable" };
    if (result === "save_failed") return { status: "failed", reason: "save_failed" };
    return { status: "failed", reason: "bridge_unavailable" };
  } finally {
    bridge.remove();
  }
}
