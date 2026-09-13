import * as vscode from "vscode";
import { discoverNonoProfiles } from "./nono-resolver";

export const NONO_PROFILE_CONFIGURATION = "opencode-chat";
export const NONO_PROFILE_SETTING = "nono.profile";
const CLEAR_PROFILE = "__clear__";

type ProfilePick = { label: string; value: string };

export function readSelectedNonoProfile(scope?: vscode.ConfigurationScope): string | undefined {
  const value = vscode.workspace.getConfiguration(NONO_PROFILE_CONFIGURATION, scope).get<unknown>(NONO_PROFILE_SETTING);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export async function selectNonoProfile(scope: vscode.ConfigurationScope): Promise<void> {
  const profiles = await discoverNonoProfiles();
  const selected = await vscode.window.showQuickPick(
    [
      { label: vscode.l10n.t("None"), value: CLEAR_PROFILE },
      ...profiles.map((profile) => ({ label: profile, value: profile })),
    ],
    {
      placeHolder: vscode.l10n.t("Select a discovered nono profile for Chat"),
      title: vscode.l10n.t("OpenCode Scribe: Select nono profile"),
    },
  );
  if (!selected) return;
  if (selected.value !== CLEAR_PROFILE && !profiles.includes(selected.value)) return;

  await vscode.workspace
    .getConfiguration(NONO_PROFILE_CONFIGURATION, scope)
    .update(
      NONO_PROFILE_SETTING,
      selected.value === CLEAR_PROFILE ? undefined : selected.value,
      vscode.ConfigurationTarget.Workspace,
    );
}

/**
 * Offer the native default only when custom profiles are present. The caller
 * deliberately does not await this promise so activation can continue with
 * the built-in profile while the optional choice is visible.
 */
export async function promptForInitialNonoProfile(
  scope: vscode.ConfigurationScope,
  profiles: readonly string[],
): Promise<string | undefined> {
  if (profiles.length === 0) return undefined;
  const selected = await vscode.window.showQuickPick<ProfilePick>(
    [{ label: "opencode", value: "opencode" }, ...profiles.map((profile) => ({ label: profile, value: profile }))],
    {
      placeHolder: vscode.l10n.t("Select a nono profile for Chat (optional)"),
      title: vscode.l10n.t("OpenCode Scribe: Select nono profile"),
      ignoreFocusOut: true,
    },
  );
  if (!selected || (!profiles.includes(selected.value) && selected.value !== "opencode")) return undefined;

  await vscode.workspace
    .getConfiguration(NONO_PROFILE_CONFIGURATION, scope)
    .update(NONO_PROFILE_SETTING, selected.value, vscode.ConfigurationTarget.Workspace);
  return selected.value;
}
