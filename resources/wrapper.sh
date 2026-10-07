#!/bin/bash
# Claude Account Switcher wrapper.
# The Claude Code extension runs: wrapper <bundled claude binary> <claude args...>
#
# ~/.claude-switcher/active holds one of:
#   max          default login in ~/.claude (never modified)
#   sub:<name>   extra subscription account, own config dir (logged in once)
#   api:<name>   Anthropic API key from the macOS Keychain, own config dir
#   <name>       legacy (v0.1) form, treated as api:<name>
DIR="${CLAUDE_SWITCHER_DIR:-$HOME/.claude-switcher}"
SHARED="settings.json settings.local.json CLAUDE.md skills agents commands plugins ide"

active=""
[ -f "$DIR/active" ] && active="$(tr -d '\n' < "$DIR/active")"
[ -z "$active" ] && active="max"

link_shared() { # $1 = config dir; share settings/skills/IDE link with ~/.claude
  mkdir -p "$1"
  for f in $SHARED; do
    [ -e "$HOME/.claude/$f" ] && [ ! -e "$1/$f" ] && ln -s "$HOME/.claude/$f" "$1/$f"
  done
}

valid_name() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$ ]]; }

case "$active" in
  max)
    unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
    ;;
  sub:*)
    name="${active#sub:}"
    valid_name "$name" || { echo "claude-switcher: invalid profile name '$name'" >&2; exit 1; }
    cfg="$DIR/accounts/$name"
    link_shared "$cfg"
    unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
    export CLAUDE_CONFIG_DIR="$cfg"
    ;;
  *)
    name="${active#api:}"
    valid_name "$name" || { echo "claude-switcher: invalid profile name '$name'" >&2; exit 1; }
    key="$(security find-generic-password -s claude-switcher -a "$name" -w 2>/dev/null)"
    if [ -z "$key" ]; then
      echo "claude-switcher: no API key found in Keychain for profile '$name'. Switch profile or re-add the key." >&2
      exit 1
    fi
    # Claude Code only honours ANTHROPIC_API_KEY once its last 20 chars are listed as
    # approved in the config dir's .claude.json, so API profiles get their own config dir.
    cfg="$DIR/api-config/$name"
    link_shared "$cfg"
    tail20="${key: -20}"
    if ! grep -qs "$tail20" "$cfg/.claude.json"; then
      printf '{"hasCompletedOnboarding":true,"customApiKeyResponses":{"approved":["%s"],"rejected":[]}}\n' "$tail20" > "$cfg/.claude.json"
    fi
    export CLAUDE_CONFIG_DIR="$cfg"
    export ANTHROPIC_API_KEY="$key"
    ;;
esac

exec "$@"
