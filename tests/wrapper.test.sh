#!/bin/bash
# Tests resources/wrapper.sh with a fake HOME and a stubbed `security`.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WRAPPER="$ROOT/resources/wrapper.sh"
fail=0

check() { # name, condition-exit-code
  if [ "$2" -eq 0 ]; then echo "ok   - $1"; else echo "FAIL - $1"; fail=1; fi
}

setup() {
  T="$(mktemp -d)"
  export HOME="$T/home" CLAUDE_SWITCHER_DIR="$T/home/.claude-switcher"
  mkdir -p "$HOME/.claude" "$T/bin" "$CLAUDE_SWITCHER_DIR"
  touch "$HOME/.claude/settings.json"; mkdir -p "$HOME/.claude/ide"
  # stub: only account "work" has a key
  cat > "$T/bin/security" <<'STUB'
#!/bin/bash
while [ $# -gt 0 ]; do [ "$1" = "-a" ] && acct="$2"; shift; done
[ "$acct" = "work" ] && echo "fake-test-key-0000000000000000000000AAAAAAAAAAAAAAAAAAAA" && exit 0
exit 44
STUB
  chmod +x "$T/bin/security"; export PATH="$T/bin:$PATH"
}
run() { "$WRAPPER" /usr/bin/env 2>"$T/err"; }

# max: leaked key is stripped, config dir untouched
setup; echo max > "$CLAUDE_SWITCHER_DIR/active"
out="$(ANTHROPIC_API_KEY=leak CLAUDE_CONFIG_DIR= run)"
echo "$out" | grep -q '^ANTHROPIC_API_KEY='; check "max strips ANTHROPIC_API_KEY" $((! $?))

# default when no active file
setup; out="$(run)"; echo "$out" | grep -q '^ANTHROPIC_API_KEY='; check "missing active file behaves as max" $((! $?))

# api:work
setup; echo api:work > "$CLAUDE_SWITCHER_DIR/active"; out="$(run)"
echo "$out" | grep -q '^ANTHROPIC_API_KEY=fake-test-key-'; check "api sets key from Keychain" $?
echo "$out" | grep -q "^CLAUDE_CONFIG_DIR=$CLAUDE_SWITCHER_DIR/api-config/work\$"; check "api uses its own config dir" $?
grep -q 'AAAAAAAAAAAAAAAAAAAA' "$CLAUDE_SWITCHER_DIR/api-config/work/.claude.json"; check "api key last-20 is approved in .claude.json" $?
[ -L "$CLAUDE_SWITCHER_DIR/api-config/work/settings.json" ] && [ -L "$CLAUDE_SWITCHER_DIR/api-config/work/ide" ]; check "api shares settings.json and ide via symlink" $?

# chat history is shared, and an old per-profile copy is merged, not lost
setup; echo sub:second > "$CLAUDE_SWITCHER_DIR/active"
mkdir -p "$CLAUDE_SWITCHER_DIR/accounts/second/projects/-p"; echo old > "$CLAUDE_SWITCHER_DIR/accounts/second/projects/-p/old.jsonl"
run >/dev/null
[ -L "$CLAUDE_SWITCHER_DIR/accounts/second/projects" ] && [ -L "$CLAUDE_SWITCHER_DIR/accounts/second/file-history" ]; check "sub shares projects and file-history via symlink" $?
[ -f "$HOME/.claude/projects/-p/old.jsonl" ]; check "existing per-profile history is merged into ~/.claude" $?
echo api:work > "$CLAUDE_SWITCHER_DIR/active"; run >/dev/null
[ "$(readlink "$CLAUDE_SWITCHER_DIR/api-config/work/projects")" = "$HOME/.claude/projects" ]; check "api profile sees the same projects dir" $?

# legacy bare name == api:
setup; echo work > "$CLAUDE_SWITCHER_DIR/active"; out="$(run)"
echo "$out" | grep -q '^ANTHROPIC_API_KEY=fake-test-key-'; check "legacy bare name treated as api" $?

# sub:second
setup; echo sub:second > "$CLAUDE_SWITCHER_DIR/active"; out="$(ANTHROPIC_API_KEY=leak run)"
echo "$out" | grep -q '^ANTHROPIC_API_KEY='; check "sub has no API key" $((! $?))
echo "$out" | grep -q "^CLAUDE_CONFIG_DIR=$CLAUDE_SWITCHER_DIR/accounts/second\$"; check "sub uses accounts/<name> config dir" $?
[ -L "$CLAUDE_SWITCHER_DIR/accounts/second/settings.json" ]; check "sub shares settings.json" $?

# missing key -> exit 1 with message
setup; echo api:ghost > "$CLAUDE_SWITCHER_DIR/active"; run >/dev/null; rc=$?
[ $rc -eq 1 ] && grep -q 'no API key found' "$T/err"; check "missing key exits 1 with message" $?

# bad names rejected
setup; echo 'sub:../evil' > "$CLAUDE_SWITCHER_DIR/active"; run >/dev/null; rc=$?
[ $rc -eq 1 ] && [ ! -e "$CLAUDE_SWITCHER_DIR/accounts" ]; check "path-traversal name rejected" $?

exit $fail
