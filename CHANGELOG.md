# Changelog

## Unreleased
- Profile picker rows now have buttons to sign in again / update the API key, rename and remove (removal was only reachable from the Command Palette before).
- `Update API Key` and `Rename Profile` commands. Adding an API key under an existing name now asks before replacing it.
- Subscription accounts that are signed out are flagged in the picker and the status bar.
- Chat history (`projects/`, `file-history/`) is now shared across profiles, so a conversation can be resumed after switching account or key. Existing per-profile history is merged into `~/.claude` on first launch.

## 0.2.0
- Multiple subscription (Max/Pro) accounts, each with its own isolated login.
- Multiple API key profiles (unchanged from 0.1), now sharing the same profile model.
- `Add Subscription Account` / `Sign In Again` / `Remove Profile` commands.
- Profile ids in `~/.claude-switcher/active` (`max`, `sub:<name>`, `api:<name>`); 0.1 data is migrated automatically.
- Wrapper and profile logic covered by tests; CI on GitHub Actions.

## 0.1.0
- Switch between the default Claude login and API keys stored in the macOS Keychain.
