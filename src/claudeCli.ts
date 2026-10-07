import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface AuthStatus {
  loggedIn: boolean;
  email?: string;
  subscriptionType?: string;
}

// Prefer the binary bundled with the Claude Code extension (the one that actually runs
// sessions); fall back to `claude` from the usual install location.
export function findClaudeBinary(claudeExtPath?: string): string | undefined {
  const candidates = [
    claudeExtPath && path.join(claudeExtPath, "resources", "native-binary", "claude"),
    path.join(os.homedir(), ".local", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ].filter((p): p is string => !!p);
  return candidates.find((p) => fs.existsSync(p));
}

function cleanEnv(configDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

export function authStatus(bin: string, configDir: string): Promise<AuthStatus> {
  return new Promise((resolve) => {
    execFile(bin, ["auth", "status", "--json"], { env: cleanEnv(configDir), timeout: 20000 }, (err, stdout) => {
      try {
        const j = JSON.parse(stdout);
        resolve({ loggedIn: !!j.loggedIn, email: j.email, subscriptionType: j.subscriptionType });
      } catch {
        resolve({ loggedIn: false });
      }
      void err;
    });
  });
}

export function logout(bin: string, configDir: string): Promise<void> {
  return new Promise((resolve) => {
    execFile(bin, ["auth", "logout"], { env: cleanEnv(configDir), timeout: 20000 }, () => resolve());
  });
}
