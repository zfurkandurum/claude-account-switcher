import * as fs from "fs";
import * as vscode from "vscode";
import { authStatus, findClaudeBinary, logout } from "./claudeCli";
import { NAME_RE, deleteKey, saveKey } from "./keychain";
import {
  MAX,
  Profile,
  accountDir,
  apiConfigDir,
  getActive,
  getLastNonDefault,
  idOf,
  listProfiles,
  parseId,
  removeProfile,
  upsertProfile,
} from "./profiles";
import { applyProfile, ensureWrapper } from "./switch";

const COMMANDS = [
  "switch",
  "toggle",
  "addSubscription",
  "addApiKey",
  "relogin",
  "remove",
].map((c) => `claudeSwitcher.${c}`);

const activeId = () => {
  const p = parseId(getActive());
  return p.kind === "max" ? MAX : idOf(p as Profile);
};

function validName(v: string): string | undefined {
  if (!NAME_RE.test(v)) return "Use letters, digits, . _ - (max 40, must start with a letter or digit)";
  if (v === MAX) return "Reserved name";
  return undefined;
}

export async function activate(ctx: vscode.ExtensionContext) {
  if (process.platform !== "darwin") {
    for (const c of COMMANDS) {
      ctx.subscriptions.push(
        vscode.commands.registerCommand(c, () =>
          vscode.window.showWarningMessage("Claude Account Switcher currently supports macOS only (it uses the Keychain).")
        )
      );
    }
    return;
  }

  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  bar.command = "claudeSwitcher.switch";
  ctx.subscriptions.push(bar);

  const refresh = () => {
    const p = parseId(getActive());
    bar.text =
      p.kind === "max"
        ? "$(account) Claude: Default"
        : p.kind === "sub"
          ? `$(account) Claude: ${p.name}`
          : `$(key) Claude: API · ${p.name}`;
    bar.tooltip = "Click to switch Claude profile (Cmd+Alt+K toggles Default ⇄ last used)";
    bar.show();
  };
  refresh();

  try {
    await ensureWrapper(ctx);
  } catch (e) {
    vscode.window.showErrorMessage(`Claude Switcher setup failed: ${(e as Error).message}`);
  }

  const claudeBin = () => {
    const bin = findClaudeBinary(vscode.extensions.getExtension("anthropic.claude-code")?.extensionPath);
    if (!bin) vscode.window.showErrorMessage("Could not find the Claude Code binary. Is the Claude Code extension installed?");
    return bin;
  };

  const switchTo = async (id: string) => {
    if (id === activeId()) return;
    await applyProfile(ctx, id);
    refresh();
  };

  // Opens `claude auth login` in a terminal bound to the account's own config dir,
  // then reads the signed-in email and saves the profile.
  const loginAccount = async (name: string, offerSwitch: boolean) => {
    const bin = claudeBin();
    if (!bin) return;
    const cfgDir = accountDir(name);
    fs.mkdirSync(cfgDir, { recursive: true });
    const term = vscode.window.createTerminal({
      name: `Claude login · ${name}`,
      shellPath: bin,
      shellArgs: ["auth", "login"],
      env: { CLAUDE_CONFIG_DIR: cfgDir, ANTHROPIC_API_KEY: null, ANTHROPIC_AUTH_TOKEN: null },
    });
    term.show();
    vscode.window.showInformationMessage(`Sign in to the account for "${name}" in the browser, then return here.`);
    const sub = vscode.window.onDidCloseTerminal(async (t) => {
      if (t !== term) return;
      sub.dispose();
      const st = await authStatus(bin, cfgDir);
      if (!st.loggedIn) {
        vscode.window.showWarningMessage(`Login for "${name}" did not complete.`);
        return;
      }
      upsertProfile({ kind: "sub", name, email: st.email });
      const msg = `Account "${name}" (${st.email ?? "unknown email"}) is ready.`;
      if (offerSwitch && (await vscode.window.showInformationMessage(msg, "Switch now"))) await switchTo(`sub:${name}`);
      else if (!offerSwitch) vscode.window.showInformationMessage(msg);
    });
    ctx.subscriptions.push(sub);
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand("claudeSwitcher.switch", async () => {
      const active = activeId();
      const mark = (id: string) => (active === id ? "active" : "");
      const items: (vscode.QuickPickItem & { id: string })[] = [
        { id: MAX, label: "$(account) Default login", description: mark(MAX), detail: "Your existing Claude login in ~/.claude" },
        ...listProfiles().map((p) => ({
          id: idOf(p),
          label: p.kind === "sub" ? `$(account) ${p.name}` : `$(key) API · ${p.name}`,
          description: [mark(idOf(p)), p.kind === "sub" ? p.email : ""].filter(Boolean).join(" · "),
        })),
        { id: "__sub", label: "$(add) Add subscription account…" },
        { id: "__api", label: "$(add) Add API key…" },
      ];
      const pick = await vscode.window.showQuickPick(items, { placeHolder: "Switch Claude profile" });
      if (!pick) return;
      if (pick.id === "__sub") await vscode.commands.executeCommand("claudeSwitcher.addSubscription");
      else if (pick.id === "__api") await vscode.commands.executeCommand("claudeSwitcher.addApiKey");
      else await switchTo(pick.id);
    }),

    vscode.commands.registerCommand("claudeSwitcher.toggle", async () => {
      if (activeId() !== MAX) return switchTo(MAX);
      const last = getLastNonDefault();
      if (!last) return vscode.commands.executeCommand("claudeSwitcher.switch");
      return switchTo(last);
    }),

    vscode.commands.registerCommand("claudeSwitcher.addSubscription", async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Name for this subscription account",
        placeHolder: "e.g. work, personal",
        validateInput: validName,
      });
      if (!name) return;
      if (listProfiles().some((p) => p.kind === "sub" && p.name === name)) {
        vscode.window.showErrorMessage(`A subscription account named "${name}" already exists.`);
        return;
      }
      await loginAccount(name, true);
    }),

    vscode.commands.registerCommand("claudeSwitcher.addApiKey", async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Name for this API key",
        placeHolder: "e.g. work, personal",
        validateInput: validName,
      });
      if (!name) return;
      const key = await vscode.window.showInputBox({
        prompt: `Anthropic API key for "${name}"`,
        placeHolder: "sk-ant-…",
        password: true,
        validateInput: (v) => (/^[A-Za-z0-9._-]{20,}$/.test(v) ? undefined : "That doesn't look like an API key"),
      });
      if (!key) return;
      try {
        await saveKey(name, key);
      } catch (e) {
        vscode.window.showErrorMessage(`Could not save key: ${(e as Error).message}`);
        return;
      }
      upsertProfile({ kind: "api", name });
      const go = await vscode.window.showInformationMessage(`API key "${name}" saved to Keychain.`, "Switch now");
      if (go) await switchTo(`api:${name}`);
      else refresh();
    }),

    vscode.commands.registerCommand("claudeSwitcher.relogin", async () => {
      const subs = listProfiles().filter((p) => p.kind === "sub");
      if (!subs.length) return vscode.window.showInformationMessage("No subscription accounts saved.");
      const pick = await vscode.window.showQuickPick(
        subs.map((p) => ({ label: p.name, description: p.email })),
        { placeHolder: "Sign in again to which account?" }
      );
      if (pick) await loginAccount(pick.label, false);
    }),

    vscode.commands.registerCommand("claudeSwitcher.remove", async () => {
      const all = listProfiles();
      if (!all.length) return vscode.window.showInformationMessage("No profiles saved.");
      const pick = await vscode.window.showQuickPick(
        all.map((p) => ({
          label: p.kind === "sub" ? `$(account) ${p.name}` : `$(key) API · ${p.name}`,
          description: p.email,
          p,
        })),
        { placeHolder: "Remove which profile?" }
      );
      if (!pick) return;
      const { p } = pick;
      const what = p.kind === "sub" ? "sign out and delete its local data" : "delete its key from the Keychain";
      const ok = await vscode.window.showWarningMessage(`Remove "${p.name}"? This will ${what}.`, { modal: true }, "Remove");
      if (!ok) return;
      if (p.kind === "api") {
        await deleteKey(p.name);
        fs.rmSync(apiConfigDir(p.name), { recursive: true, force: true });
      } else {
        const bin = findClaudeBinary(vscode.extensions.getExtension("anthropic.claude-code")?.extensionPath);
        if (bin) await logout(bin, accountDir(p.name));
        fs.rmSync(accountDir(p.name), { recursive: true, force: true });
      }
      const wasActive = activeId() === idOf(p);
      removeProfile(p);
      if (wasActive) await applyProfile(ctx, MAX);
      refresh();
    })
  );
}

export function deactivate() {}
