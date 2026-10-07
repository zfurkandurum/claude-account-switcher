# Contributing

Issues and PRs are welcome.

```bash
bun install
bun run typecheck
bun run test      # unit tests + wrapper shell tests (no Keychain or network needed)
bun run install-ext   # package and install into your VS Code
```

Guidelines:
- Keep `resources/wrapper.sh` plain bash with no dependencies; it runs on every Claude Code launch.
- Profile name rules live in two places and must match: `NAME_RE` in `src/keychain.ts` and `valid_name()` in the wrapper.
- Never log or write API keys anywhere except the Keychain.
