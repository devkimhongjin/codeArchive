import type { CodeArchiveBridgeProtocolVersion } from "./extension-dashboard-sync";

export const CODEARCHIVE_RELAY_DEVICE_ID_MIN_LENGTH = 16 as const;
export const CODEARCHIVE_RELAY_DEVICE_ID_MAX_LENGTH = 128 as const;
export const CODEARCHIVE_RELAY_PUBLIC_KEY_MAX_LENGTH = 2048 as const;
export const CODEARCHIVE_RELAY_CHALLENGE_ID_MAX_LENGTH = 64 as const;
export const CODEARCHIVE_RELAY_CHALLENGE_MAX_LENGTH = 256 as const;
export const CODEARCHIVE_RELAY_SIGNATURE_MAX_LENGTH = 512 as const;
export const CODEARCHIVE_RELAY_GRANT_ID_MAX_LENGTH = 64 as const;
export const CODEARCHIVE_RELAY_CREDENTIAL_MAX_LENGTH = 512 as const;

/**
 * Cross-app relay pairing control plane for Issue #177.
 *
 * This plane is deliberately separate from both the source-bearing capture
 * capability plane and the metadata-only popup automation plane. Messages may
 * contain only the exact pairing material declared below. They never carry
 * account identity, Dashboard/OAuth credentials, GitHub target/provider data,
 * capture/source/problem data, cookies, or ordinary API credentials.
 *
 * Runtime implementations must additionally enforce:
 * - exact approved Dashboard origin;
 * - exactly one eligible Dashboard Port;
 * - current device identity;
 * - most recently signed, unexpired challengeId;
 * - strict bounds exported by this module;
 * - positive safe-integer generation and valid absolute timestamps.
 */

export type CodeArchiveRelayDeviceId = string;
export type CodeArchiveRelayChallengeId = string;
export type CodeArchiveRelayGrantId = string;

export type CodeArchiveRelayLocalState =
  | "UNPAIRED"
  | "ACTIVE"
  | "REVOCATION_PENDING"
  | "EXPIRED"
  | "INVALIDATED";

interface CodeArchiveRelayMessageBase {
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
}

interface CodeArchiveRelayDeviceMessageBase extends CodeArchiveRelayMessageBase {
  readonly deviceId: CodeArchiveRelayDeviceId;
}

interface CodeArchiveRelayGrantMetadata {
  readonly grantId: CodeArchiveRelayGrantId;
  readonly generation: number;
  readonly expiresAt: string;
}

/** Dashboard -> Extension. Explicit feature-detection request; never unsolicited by Extension. */
export interface CodeArchiveRelayPairingInfoRequest extends CodeArchiveRelayMessageBase {
  readonly type: "CODEARCHIVE_RELAY_PAIRING_INFO";
  readonly phase: "REQUEST";
}

interface CodeArchiveRelayPairingInfoBase extends CodeArchiveRelayDeviceMessageBase {
  readonly type: "CODEARCHIVE_RELAY_PAIRING_INFO";
  readonly phase: "INFO";
  readonly publicKey: string;
}

/** Extension -> Dashboard. No grant metadata exists before a device has been paired. */
export interface CodeArchiveRelayPairingInfoUnpaired
  extends CodeArchiveRelayPairingInfoBase {
  readonly state: "UNPAIRED";
  readonly grantId?: never;
  readonly generation?: never;
  readonly expiresAt?: never;
}

/**
 * Extension -> Dashboard. Non-secret grant metadata is present for every local
 * state that refers to a previously provisioned grant. Credential is forbidden.
 */
export interface CodeArchiveRelayPairingInfoPaired
  extends CodeArchiveRelayPairingInfoBase, CodeArchiveRelayGrantMetadata {
  readonly state: Exclude<CodeArchiveRelayLocalState, "UNPAIRED">;
}

export type CodeArchiveRelayPairingInfoResponse =
  | CodeArchiveRelayPairingInfoUnpaired
  | CodeArchiveRelayPairingInfoPaired;

/** Dashboard -> Extension: request proof-of-possession for one API challenge. */
export interface CodeArchiveRelaySignChallengeRequest
  extends CodeArchiveRelayDeviceMessageBase {
  readonly type: "CODEARCHIVE_RELAY_SIGN_CHALLENGE";
  readonly phase: "REQUEST";
  readonly challengeId: CodeArchiveRelayChallengeId;
  readonly challenge: string;
  readonly expiresAt: string;
}

/**
 * Extension -> Dashboard: signature for the exact current challengeId.
 * The raw challenge is intentionally not echoed back.
 */
export interface CodeArchiveRelaySignChallengeResponse
  extends CodeArchiveRelayDeviceMessageBase {
  readonly type: "CODEARCHIVE_RELAY_SIGN_CHALLENGE";
  readonly phase: "SIGNED";
  readonly challengeId: CodeArchiveRelayChallengeId;
  readonly signature: string;
}

/**
 * Dashboard -> Extension.
 * This is the only pairing message shape in which the relay credential may
 * exist. It is the narrow append-only relay credential described by #177.
 */
export interface CodeArchiveRelayGrantProvisionRequest
  extends CodeArchiveRelayDeviceMessageBase, CodeArchiveRelayGrantMetadata {
  readonly type: "CODEARCHIVE_RELAY_GRANT_PROVISION";
  readonly phase: "REQUEST";
  readonly challengeId: CodeArchiveRelayChallengeId;
  readonly credential: string;
}

/** Extension -> Dashboard: confirms durable local storage without echoing secret material. */
export interface CodeArchiveRelayGrantProvisionResponse
  extends CodeArchiveRelayDeviceMessageBase, CodeArchiveRelayGrantMetadata {
  readonly type: "CODEARCHIVE_RELAY_GRANT_PROVISION";
  readonly phase: "STORED";
}

/** Dashboard -> Extension: confirms server-side revoke/disable for one grant generation. */
export interface CodeArchiveRelayRevokeConfirmedRequest
  extends CodeArchiveRelayDeviceMessageBase {
  readonly type: "CODEARCHIVE_RELAY_REVOKE_CONFIRMED";
  readonly phase: "REQUEST";
  readonly grantId: CodeArchiveRelayGrantId;
  readonly generation: number;
  readonly revokedAt: string;
}

/** Extension -> Dashboard: confirms the local revoke transition was applied. */
export interface CodeArchiveRelayRevokeConfirmedResponse
  extends CodeArchiveRelayDeviceMessageBase {
  readonly type: "CODEARCHIVE_RELAY_REVOKE_CONFIRMED";
  readonly phase: "APPLIED";
  readonly grantId: CodeArchiveRelayGrantId;
  readonly generation: number;
  readonly revokedAt: string;
}

export type DashboardToExtensionRelayPairingMessage =
  | CodeArchiveRelayPairingInfoRequest
  | CodeArchiveRelaySignChallengeRequest
  | CodeArchiveRelayGrantProvisionRequest
  | CodeArchiveRelayRevokeConfirmedRequest;

export type ExtensionToDashboardRelayPairingMessage =
  | CodeArchiveRelayPairingInfoResponse
  | CodeArchiveRelaySignChallengeResponse
  | CodeArchiveRelayGrantProvisionResponse
  | CodeArchiveRelayRevokeConfirmedResponse;

export type CodeArchiveRelayPairingMessage =
  | DashboardToExtensionRelayPairingMessage
  | ExtensionToDashboardRelayPairingMessage;
