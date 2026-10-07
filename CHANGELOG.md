# Changelog

## 0.2.0
- Multiple subscription (Max/Pro) accounts, each with its own isolated login.
- Multiple API key profiles (unchanged from 0.1), now sharing the same profile model.
- `Add Subscription Account` / `Sign In Again` / `Remove Profile` commands.
- Profile ids in `~/.claude-switcher/active` (`max`, `sub:<name>`, `api:<name>`); 0.1 data is migrated automatically.
- Wrapper and profile logic covered by tests; CI on GitHub Actions.

## 0.1.0
- Switch between the default Claude login and API keys stored in the macOS Keychain.
