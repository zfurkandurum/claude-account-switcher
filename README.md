# Claude Account Switcher

Switch the **Claude Code VS Code extension** between several identities with one key press:

- your existing Claude login (the *default*),
- any number of extra **subscription accounts** (Max / Pro), each signed in separately,
- any number of **Anthropic API keys**, stored in the macOS Keychain.

`Cmd+Alt+K` toggles between the default login and the profile you used last. The status bar item shows the active profile and opens a picker.

> macOS only (API keys use the Keychain). Not affiliated with Anthropic.

## Install

From a release `.vsix`:

```bash
code --install-extension claude-account-switcher-<version>.vsix
```

Or from source: `bun install && bun run install-ext`. Then reload VS Code.

## Use

| Command (`Cmd+Shift+P` → "Claude Switcher") | What it does |
| --- | --- |
| Switch Profile | Pick the default login, a subscription account or an API key |
| Toggle Default / Last Used Profile | Same as `Cmd+Alt+K` |
| Add Subscription Account | Opens `claude auth login` for a new account in a terminal; sign in in the browser |
| Add API Key Profile | Saves a key to the Keychain |
| Sign In Again to a Subscription Account | Refresh an expired login |
| Remove Profile | Signs out / deletes the key and local data for that profile |

Switching reloads the window so every Claude Code chat restarts with the new identity (turn this off with `claudeSwitcher.reloadOnSwitch`; then only new chats use it).

## How it works

```
Claude Code extension ──runs──▶ ~/.claude-switcher/wrapper.sh <claude> <args…>
                                   │ reads ~/.claude-switcher/active
                                   ├─ max        → unset API key, default ~/.claude
                                   ├─ sub:<name> → CLAUDE_CONFIG_DIR=~/.claude-switcher/accounts/<name>
                                   └─ api:<name> → key from Keychain + CLAUDE_CONFIG_DIR=…/api-config/<name>
                                   └─ exec <claude> <args…>
```

- The extension sets `claudeCode.claudeProcessWrapper` to the wrapper once.
- Your default login in `~/.claude` is never modified.
- Subscription and API profiles live in their own config directories, with `settings.json`, `CLAUDE.md`, skills, agents, commands, plugins and the IDE link shared (symlinked) from `~/.claude`. Chat history (`projects/`) is shared too, so after switching you can reopen a previous conversation from the Claude Code history list and continue it with the new account.
- API keys: Claude Code only uses `ANTHROPIC_API_KEY` when the key's last 20 characters are listed as approved in the config directory's `.claude.json`. The wrapper writes that approval into the profile's own directory.

## Security

Keys live only in the Keychain (service `claude-switcher`) and are passed to `security` via stdin, never as command-line arguments. Nothing is sent anywhere by this extension. The first launch with a key may show a Keychain prompt; choose *Always Allow*. See [SECURITY.md](SECURITY.md).

## Limitations & caveats

- It relies on two behaviours Claude Code does not document as stable: `claudeCode.claudeProcessWrapper` and the `customApiKeyResponses` approval. A Claude Code update could break it; please open an issue.
- `/status` inside a chat may still mention the default login's account; the reliable check is `apiKeySource` / your console usage for API profiles, and the email shown for subscription accounts.
- Use accounts and keys you are entitled to use, and follow Anthropic's terms for each.
- Running chats restart when you switch; the conversation is not lost, but you have to reopen it from the history list (a live process cannot change account mid-run).

## Uninstall

Remove the extension, delete `claudeCode.claudeProcessWrapper` from your VS Code settings and run `rm -rf ~/.claude-switcher`. Keychain entries can be removed with *Remove Profile* beforehand, or with `security delete-generic-password -s claude-switcher -a <name>`.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed.
