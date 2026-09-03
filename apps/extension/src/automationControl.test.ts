import { describe, expect, it, vi } from "vitest";
import type { CodeArchiveAutomationState } from "../../../packages/shared-types/src";
import { AutomationControlController } from "./automationControl";

class TestPort {
  readonly posted: unknown[] = [];
  postMessage(message: unknown): void { this.posted.push(message); }
}

const connectedState: CodeArchiveAutomationState = {
  protocolVersion: 1,
  autoSyncEnabled: true,
  githubAutoCommitEnabled: false,
  githubTargetConfigured: true,
  authenticated: true,
  connectionAvailable: true,
  errorCode: null,
};

function stateUpdate(state: CodeArchiveAutomationState): unknown {
  return { type: "CODEARCHIVE_AUTOMATION_STATE_UPDATE", protocolVersion: 1, state };
}

describe("AutomationControlController", () => {
  it("keeps state unavailable and does not route without exactly one Dashboard port", async () => {
    const controller = new AutomationControlController();
    const response = await controller.requestState();
    expect(response.forwarded).toBe(false);
    expect(response.state.connectionAvailable).toBe(false);
    expect(await controller.setAutomation("AUTO_SYNC", true)).toMatchObject({ accepted: false, forwarded: false });
  });

  it("routes a state request to the only port and adopts only the authoritative update", async () => {
    const controller = new AutomationControlController();
    const port = new TestPort();
    controller.connect(port);

    const pending = controller.requestState();
    expect(port.posted).toEqual([{ type: "CODEARCHIVE_AUTOMATION_STATE_REQUEST", protocolVersion: 1 }]);
    expect(controller.getState().autoSyncEnabled).toBe(false);
    expect(controller.receive(port, stateUpdate(connectedState))).toBe(true);
    await expect(pending).resolves.toEqual({ state: connectedState, forwarded: true });
  });

  it("forwards SET intent without optimistic local state and resolves after Dashboard publication", async () => {
    const controller = new AutomationControlController();
    const port = new TestPort();
    controller.connect(port);
    controller.receive(port, stateUpdate(connectedState));

    const nextState = { ...connectedState, autoSyncEnabled: false };
    const pending = controller.setAutomation("AUTO_SYNC", false);
    expect(port.posted.at(-1)).toEqual({ type: "CODEARCHIVE_AUTOMATION_SET_REQUEST", protocolVersion: 1, automation: "AUTO_SYNC", enabled: false });
    expect(controller.getState().autoSyncEnabled).toBe(true);
    controller.receive(port, stateUpdate(nextState));
    await expect(pending).resolves.toEqual({ accepted: true, state: nextState, forwarded: true });
  });

  it("sends the safety stop and invalidates the source session when a second port connects", () => {
    const onSafetyStop = vi.fn();
    const controller = new AutomationControlController(onSafetyStop);
    const first = new TestPort();
    const second = new TestPort();
    controller.connect(first);
    controller.connect(second);

    const expected = { type: "CODEARCHIVE_AUTOMATION_SAFETY_STOP", protocolVersion: 1, errorCode: "MULTIPLE_DASHBOARD_TABS" };
    expect(first.posted).toContainEqual(expected);
    expect(second.posted).toContainEqual(expected);
    expect(onSafetyStop).toHaveBeenCalledOnce();
    expect(controller.getState()).toMatchObject({ connectionAvailable: false, errorCode: "MULTIPLE_DASHBOARD_TABS" });
  });

  it("does not resume after one conflicting tab disappears until a fresh state publication", async () => {
    const controller = new AutomationControlController();
    const first = new TestPort();
    const second = new TestPort();
    controller.connect(first);
    controller.connect(second);
    controller.disconnect(second);

    expect(controller.activePortCount()).toBe(1);
    await expect(controller.requestState()).resolves.toMatchObject({ forwarded: false });
    expect(controller.receive(first, stateUpdate(connectedState))).toBe(true);
    expect(controller.getState()).toEqual(connectedState);
  });

  it("rejects malformed or extra-field state updates", () => {
    const controller = new AutomationControlController();
    const port = new TestPort();
    controller.connect(port);
    expect(controller.receive(port, { ...stateUpdate(connectedState) as object, extra: "secret" })).toBe(false);
    expect(controller.receive(port, { ...stateUpdate(connectedState) as object, state: { ...connectedState, autoSyncEnabled: "true" } })).toBe(false);
    expect(controller.getState().connectionAvailable).toBe(false);
  });
});
