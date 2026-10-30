import * as fs from "fs";
import * as vscode from "vscode";
import { AuthStatus, authStatus, findClaudeBinary, logout } from "./claudeCli";
import { NAME_RE, deleteKey, saveKey } from "./keychain";
import {
  MAX,
  Profile,
  accountDir,
  deleteProfileDir,
  displayName,
  getActive,
  getLastNonDefault,
  idOf,
  listProfiles,
  parseId,
  removeProfile,
  setLabel,
  upsertProfile,
} from "./profiles";
import { applyProfile, ensureWrapper } from "./switch";

const COMMANDS = [
  "switch",
  "toggle",
  "addSubscription",
  "addApiKey",
  "updateApiKey",
  "rename",
  "relogin",
  "remove",
].map((c) => `claudeSwitcher.${c}`);

const activeId = () => {
  const p = parseId(getActive());
  return p.kind === "max" ? MAX : idOf(p as Profile);
};

const labelOf = (p: Profile) => (p.kind === "sub" ? `$(account) ${displayName(p)}` : `$(key) API · ${displayName(p)}`);

function validName(v: string): string | undefined {
  if (!NAME_RE.test(v)) return "Use letters, digits, . _ - (max 40, must start with a letter or digit)";
  if (v === MAX) return "Reserved name";
  return undefined;
}

const validLabel = (p: Profile) => (v: string) => {
  const t = v.trim();
  if (!t) return "The name can't be empty";
  if (t.length > 40) return "Max 40 characters";
  if (listProfiles().some((x) => x.kind === p.kind && idOf(x) !== idOf(p) && displayName(x) === t)) {
    return "Another profile already uses this name";
  }
  return undefined;
};

const BTN = {
  login: { iconPath: new vscode.ThemeIcon("refresh"), tooltip: "Sign in again" },
  key: { iconPath: new vscode.ThemeIcon("key"), tooltip: "Update API key" },
  rename: { iconPath: new vscode.ThemeIcon("edit"), tooltip: "Rename" },
  remove: { iconPath: new vscode.ThemeIcon("trash"), tooltip: "Remove" },
} satisfies Record<string, vscode.QuickInputButton>;

type PickItem = vscode.QuickPickItem & { id: string; profile?: Profile };

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

  // Last known sign-in state of each subscription account (by name) for this session.
  const authCache = new Map<string, AuthStatus>();

  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  bar.command = "claudeSwitcher.switch";
  ctx.subscriptions.push(bar);

  const refresh = () => {
    const p = parseId(getActive());
    if (p.kind === "max") {
      bar.text = "$(account) Claude: Default";
    } else {
      const shown = displayName(listProfiles().find((x) => idOf(x) === idOf(p as Profile)) ?? (p as Profile));
      const signedOut = p.kind === "sub" && authCache.get(p.name)?.loggedIn === false;
      bar.text = signedOut
        ? `$(warning) Claude: ${shown}`
        : p.kind === "sub"
          ? `$(account) Claude: ${shown}`
          : `$(key) Claude: API · ${shown}`;
      if (signedOut) {
        bar.tooltip = "Signed out. Click to switch profile or sign in again.";
        bar.show();
        return;
      }
    }
    bar.tooltip = "Click to switch Claude profile (Cmd+Alt+K toggles Default ⇄ last used)";
    bar.show();
  };
  refresh();

  try {
    await ensureWrapper(ctx);
  } catch (e) {
    vscode.window.showErrorMessage(`Claude Switcher setup failed: ${(e as Error).message}`);
  }

  const findBin = () => findClaudeBinary(vscode.extensions.getExtension("anthropic.claude-code")?.extensionPath);
  const claudeBin = () => {
    const bin = findBin();
    if (!bin) vscode.window.showErrorMessage("Could not find the Claude Code binary. Is the Claude Code extension installed?");
    return bin;
  };

  // Reads the account's sign-in state and keeps the stored email fresh.
  const checkAuth = async (bin: string, name: string) => {
    const st = await authStatus(bin, accountDir(name));
    authCache.set(name, st);
    const stored = listProfiles().find((x) => x.kind === "sub" && x.name === name);
    if (stored && st.loggedIn && st.email && stored.email !== st.email) upsertProfile({ kind: "sub", name, email: st.email });
    refresh();
    return st;
  };

  const active = parseId(getActive());
  if (active.kind === "sub") {
    const bin = findBin();
    if (bin) void checkAuth(bin, active.name);
  }

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
      authCache.set(name, st);
      refresh();
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

  const promptKey = (name: string) =>
    vscode.window.showInputBox({
      prompt: `Anthropic API key for "${name}"`,
      placeHolder: "sk-ant-…",
      password: true,
      validateInput: (v) => (/^[A-Za-z0-9._-]{20,}$/.test(v) ? undefined : "That doesn't look like an API key"),
    });

  const updateKeyFlow = async (p: Profile) => {
    const key = await promptKey(displayName(p));
    if (!key) return;
    try {
      await saveKey(p.name, key);
    } catch (e) {
      vscode.window.showErrorMessage(`Could not save key: ${(e as Error).message}`);
      return;
    }
    if (activeId() === idOf(p)) {
      // Running sessions keep the old key until the window reloads.
      const go = await vscode.window.showInformationMessage(`API key "${displayName(p)}" updated.`, "Reload now");
      if (go) await vscode.commands.executeCommand("workbench.action.reloadWindow");
    } else {
      vscode.window.showInformationMessage(`API key "${displayName(p)}" updated.`);
    }
  };

  const renameFlow = async (p: Profile) => {
    const value = await vscode.window.showInputBox({
      prompt: `New name for "${displayName(p)}"`,
      value: displayName(p),
      validateInput: validLabel(p),
    });
    if (value === undefined) return;
    const label = value.trim();
    setLabel(p, label === p.name ? undefined : label);
    refresh();
  };

  const removeFlow = async (p: Profile) => {
    const isActive = activeId() === idOf(p);
    const what = p.kind === "sub" ? "sign out and delete its local data" : "delete its key from the Keychain";
    const note = isActive ? " It is the active profile, so the window will switch to the default login and reload." : "";
    const ok = await vscode.window.showWarningMessage(
      `Remove "${displayName(p)}"? This will ${what}.${note}`,
      { modal: true },
      "Remove"
    );
    if (!ok) return;
    if (p.kind === "api") {
      await deleteKey(p.name);
    } else {
      const bin = findBin();
      if (bin) await logout(bin, accountDir(p.name));
      authCache.delete(p.name);
    }
    deleteProfileDir(p);
    removeProfile(p);
    if (isActive) await applyProfile(ctx, MAX);
    refresh();
  };

  const pickProfile = async (placeHolder: string, kind?: Profile["kind"]) => {
    const all = listProfiles().filter((p) => !kind || p.kind === kind);
    if (!all.length) {
      vscode.window.showInformationMessage(kind === "api" ? "No API keys saved." : kind === "sub" ? "No subscription accounts saved." : "No profiles saved.");
      return undefined;
    }
    const pick = await vscode.window.showQuickPick(
      all.map((p) => ({ label: labelOf(p), description: p.email, p })),
      { placeHolder }
    );
    return pick?.p;
  };

  const choose = async (it: PickItem) => {
    if (it.id === "__sub") return vscode.commands.executeCommand("claudeSwitcher.addSubscription");
    if (it.id === "__api") return vscode.commands.executeCommand("claudeSwitcher.addApiKey");
    const p = it.profile;
    if (p?.kind === "sub" && authCache.get(p.name)?.loggedIn === false) return loginAccount(p.name, true);
    return switchTo(it.id);
  };

  // Row buttons run their action once the picker has closed, then the picker reopens
  // so the change is visible (except sign-in, where the terminal needs the focus).
  const showPicker = async (): Promise<void> => {
    const qp = vscode.window.createQuickPick<PickItem>();
    qp.placeholder = "Switch Claude profile";
    let disposed = false;
    let action: (() => Promise<unknown>) | undefined;
    let reopen = false;

    const build = (): PickItem[] => {
      const cur = activeId();
      const mark = (id: string) => (cur === id ? "active" : "");
      return [
        { id: MAX, label: "$(account) Default login", description: mark(MAX), detail: "Your existing Claude login in ~/.claude" },
        ...listProfiles().map((p): PickItem => {
          const signedOut = p.kind === "sub" && authCache.get(p.name)?.loggedIn === false;
          return {
            id: idOf(p),
            profile: p,
            label: labelOf(p),
            description: [
              mark(idOf(p)),
              p.kind === "sub" ? p.email : "",
              signedOut ? "$(warning) signed out · select to sign in" : "",
            ]
              .filter(Boolean)
              .join(" · "),
            buttons: p.kind === "sub" ? [BTN.login, BTN.rename, BTN.remove] : [BTN.key, BTN.rename, BTN.remove],
          };
        }),
        { id: "__sub", label: "$(add) Add subscription account…" },
        { id: "__api", label: "$(add) Add API key…" },
      ];
    };
    const setItems = () => {
      const keep = qp.activeItems[0]?.id;
      qp.items = build();
      const again = qp.items.find((i) => i.id === keep);
      if (again) qp.activeItems = [again];
    };
    setItems();

    // Accounts already known to be signed in are not re-checked in this session.
    const bin = findBin();
    const toCheck = bin ? listProfiles().filter((p) => p.kind === "sub" && !authCache.get(p.name)?.loggedIn) : [];
    if (bin && toCheck.length) {
      let left = toCheck.length;
      qp.busy = true;
      for (const p of toCheck) {
        void checkAuth(bin, p.name).then(() => {
          if (disposed) return;
          if (--left === 0) qp.busy = false;
          setItems();
        });
      }
    }

    qp.onDidAccept(() => {
      const it = qp.selectedItems[0];
      if (!it) return;
      action = () => choose(it);
      qp.hide();
    });
    qp.onDidTriggerItemButton((e) => {
      const p = e.item.profile;
      if (!p) return;
      reopen = e.button !== BTN.login;
      action =
        e.button === BTN.login
          ? () => loginAccount(p.name, false)
          : e.button === BTN.key
            ? () => updateKeyFlow(p)
            : e.button === BTN.rename
              ? () => renameFlow(p)
              : () => removeFlow(p);
      qp.hide();
    });
    const hidden = new Promise<void>((resolve) =>
      qp.onDidHide(() => {
        disposed = true;
        qp.dispose();
        resolve();
      })
    );
    qp.show();
    await hidden;
    if (action) await action();
    if (reopen) await showPicker();
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand("claudeSwitcher.switch", showPicker),

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
      const existing = listProfiles().find((p) => p.kind === "api" && p.name === name);
      if (existing) {
        const ok = await vscode.window.showWarningMessage(
          `An API key named "${name}" already exists. Replace its key?`,
          { modal: true },
          "Replace"
        );
        if (ok) await updateKeyFlow(existing);
        return;
      }
      const key = await promptKey(name);
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

    vscode.commands.registerCommand("claudeSwitcher.updateApiKey", async () => {
      const p = await pickProfile("Update the key of which profile?", "api");
      if (p) await updateKeyFlow(p);
    }),

    vscode.commands.registerCommand("claudeSwitcher.rename", async () => {
      const p = await pickProfile("Rename which profile?");
      if (p) await renameFlow(p);
    }),

    vscode.commands.registerCommand("claudeSwitcher.relogin", async () => {
      const p = await pickProfile("Sign in again to which account?", "sub");
      if (p) await loginAccount(p.name, false);
    }),

    vscode.commands.registerCommand("claudeSwitcher.remove", async () => {
      const p = await pickProfile("Remove which profile?");
      if (p) await removeFlow(p);
    })
  );
}

export function deactivate() {}
