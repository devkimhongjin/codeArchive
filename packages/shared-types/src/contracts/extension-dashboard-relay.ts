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
 * - positive safe-integer generation and valid absolute expiry timestamps.
 */

export type CodeArchiveRelayDeviceId = string;
export type CodeArchiveRelayChallengeId = string;
export type CodeArchiveRelayGrantId = string;

interface CodeArchiveRelayPairingMessageBase {
  readonly protocolVersion: CodeArchiveBridgeProtocolVersion;
  readonly deviceId: CodeArchiveRelayDeviceId;
}

/**
 * Extension -> Dashboard.
 * Announces only the local device identifier and Ed25519 SPKI public key.
 */
export interface CodeArchiveRelayPairingInfoMessage
  extends CodeArchiveRelayPairingMessageBase {
  readonly type: "CODEARCHIVE_RELAY_PAIRING_INFO";
  readonly publicKey: string;
}

/** Dashboard -> Extension: request proof-of-possession for one API challenge. */
export interface CodeArchiveRelaySignChallengeRequest
  extends CodeArchiveRelayPairingMessageBase {
  readonly type: "CODEARCHIVE_RELAY_SIGN_CHALLENGE";
  readonly phase: "REQUEST";
  readonly challengeId: CodeArchiveRelayChallengeId;
  readonly challenge: string;
  readonly expiresAt: string;
}

/**
 * Extension -> Dashboard: signature for the exact current challengeId.
 * The raw challenge is intentionally not echoed back; Dashboard already owns
 * the API challenge response that it must submit with this signature.
 */
export interface CodeArchiveRelaySignChallengeResponse
  extends CodeArchiveRelayPairingMessageBase {
  readonly type: "CODEARCHIVE_RELAY_SIGN_CHALLENGE";
  readonly phase: "SIGNED";
  readonly challengeId: CodeArchiveRelayChallengeId;
  readonly signature: string;
}

/**
 * Dashboard -> Extension.
 * The relay credential is permitted in this message family only and must be
 * persisted only as the narrow append-only relay credential described by #177.
 */
export interface CodeArchiveRelayGrantProvisionMessage
  extends CodeArchiveRelayPairingMessageBase {
  readonly type: "CODEARCHIVE_RELAY_GRANT_PROVISION";
  readonly challengeId: CodeArchiveRelayChallengeId;
  readonly grantId: CodeArchiveRelayGrantId;
  readonly credential: string;
  readonly generation: number;
  readonly expiresAt: string;
}

/**
 * Dashboard -> Extension.
 * Confirms server-side revoke/disable for the previously provisioned grant.
 * No credential is ever repeated in a revoke confirmation.
 */
export interface CodeArchiveRelayRevokeConfirmedMessage
  extends CodeArchiveRelayPairingMessageBase {
  readonly type: "CODEARCHIVE_RELAY_REVOKE_CONFIRMED";
  readonly grantId: CodeArchiveRelayGrantId;
  readonly generation: number;
  readonly revokedAt: string;
}

export type ExtensionToDashboardRelayPairingMessage =
  | CodeArchiveRelayPairingInfoMessage
  | CodeArchiveRelaySignChallengeResponse;

export type DashboardToExtensionRelayPairingMessage =
  | CodeArchiveRelaySignChallengeRequest
  | CodeArchiveRelayGrantProvisionMessage
  | CodeArchiveRelayRevokeConfirmedMessage;

export type CodeArchiveRelayPairingMessage =
  | ExtensionToDashboardRelayPairingMessage
  | DashboardToExtensionRelayPairingMessage;
