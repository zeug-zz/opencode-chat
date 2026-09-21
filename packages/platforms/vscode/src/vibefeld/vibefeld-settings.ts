/**
 * Host-private reasoning-review preference for the Vibefeld activation.
 *
 * The user preference lives at the Global configuration target; a workspace
 * can only opt out. Effective enablement is the pure composition
 * `userEnabled && !workspaceOptOut && runtime.state === "available"`.
 * Policy readiness is not a separate input: the activation preflight publishes
 * `available` only once the dedicated policy reports ready, so a ready policy
 * is already folded into the runtime state.
 */
import type { ReasoningReviewRuntime } from "@opencode-chat/core";
import * as vscode from "vscode";

export const VIBEFELD_CONFIGURATION = "opencode-chat";
export const VIBEFELD_ENABLED_SETTING = "vibefeld.enabled";
export const VIBEFELD_WORKSPACE_OPT_OUT_SETTING = "vibefeld.workspaceOptOut";

export type VibefeldPreference = {
  userEnabled: boolean;
  workspaceOptOut: boolean;
};

/**
 * Availability-gated auto-on defaults: the preference is enabled and no
 * workspace has opted out, so a workspace inherits the preference until it
 * explicitly opts out. Absent and non-boolean stored values resolve here.
 */
export const DEFAULT_VIBEFELD_PREFERENCE: VibefeldPreference = {
  userEnabled: true,
  workspaceOptOut: false,
};

function readBoolean(key: string, fallback: boolean, scope?: vscode.ConfigurationScope): boolean {
  const stored = vscode.workspace.getConfiguration(VIBEFELD_CONFIGURATION, scope).get<unknown>(key);
  return typeof stored === "boolean" ? stored : fallback;
}

/**
 * Read the effective preference at the given scope. `vibefeld.enabled` is
 * inherited from the Global target unless a nearer override exists, and
 * `vibefeld.workspaceOptOut` is read at the same scope. Absent and
 * non-boolean values fall back to `DEFAULT_VIBEFELD_PREFERENCE`.
 */
export function readVibefeldPreference(scope?: vscode.ConfigurationScope): VibefeldPreference {
  return {
    userEnabled: readBoolean(VIBEFELD_ENABLED_SETTING, DEFAULT_VIBEFELD_PREFERENCE.userEnabled, scope),
    workspaceOptOut: readBoolean(
      VIBEFELD_WORKSPACE_OPT_OUT_SETTING,
      DEFAULT_VIBEFELD_PREFERENCE.workspaceOptOut,
      scope,
    ),
  };
}

/**
 * Pure effective-state resolution. `available` already implies a ready policy
 * (see the module note); a missing preflight result, `checking`, `unavailable`,
 * and `incompatible` all leave the review disabled. This reads no
 * configuration, starts no preflight, and touches no runtime.
 */
export function resolveEffectiveVibefeldEnabled(
  preference: VibefeldPreference,
  runtime: Pick<ReasoningReviewRuntime, "state"> | undefined,
): boolean {
  return preference.userEnabled && !preference.workspaceOptOut && runtime?.state === "available";
}

/**
 * Persist the user preference at the Global target. This writes only
 * `vibefeld.enabled` and never another configuration key.
 */
export async function updateVibefeldEnabled(value: boolean, scope?: vscode.ConfigurationScope): Promise<void> {
  await vscode.workspace
    .getConfiguration(VIBEFELD_CONFIGURATION, scope)
    .update(VIBEFELD_ENABLED_SETTING, value, vscode.ConfigurationTarget.Global);
}

/**
 * Persist the per-workspace opt-out at the Workspace target. This writes only
 * `vibefeld.workspaceOptOut` and never another configuration key.
 */
export async function updateVibefeldWorkspaceOptOut(value: boolean, scope?: vscode.ConfigurationScope): Promise<void> {
  await vscode.workspace
    .getConfiguration(VIBEFELD_CONFIGURATION, scope)
    .update(VIBEFELD_WORKSPACE_OPT_OUT_SETTING, value, vscode.ConfigurationTarget.Workspace);
}
