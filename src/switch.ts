import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { dir, setActive, wrapperPath } from "./profiles";

// Copies the bundled wrapper into ~/.claude-switcher and points Claude Code at it.
export async function ensureWrapper(ctx: vscode.ExtensionContext): Promise<void> {
  fs.mkdirSync(dir(), { recursive: true });
  fs.copyFileSync(path.join(ctx.extensionPath, "resources", "wrapper.sh"), wrapperPath());
  fs.chmodSync(wrapperPath(), 0o755);

  const cfg = vscode.workspace.getConfiguration("claudeCode");
  const current = cfg.get<string>("claudeProcessWrapper");
  if (current === wrapperPath()) return;
  if (current) {
    vscode.window.showWarningMessage(
      `Claude Switcher: claudeCode.claudeProcessWrapper is already set to "${current}". Clear it so the switcher can take over.`
    );
    return;
  }
  await cfg.update("claudeProcessWrapper", wrapperPath(), vscode.ConfigurationTarget.Global);
}

export async function applyProfile(ctx: vscode.ExtensionContext, id: string): Promise<void> {
  await ensureWrapper(ctx);
  setActive(id);
  if (vscode.workspace.getConfiguration("claudeSwitcher").get<boolean>("reloadOnSwitch", true)) {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  } else {
    vscode.window.showInformationMessage(
      `Claude profile switched. New Claude sessions will use it; reload the window to apply to all.`
    );
  }
}
