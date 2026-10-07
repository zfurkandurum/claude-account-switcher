import { execFile } from "child_process";

export const SERVICE = "claude-switcher";

// Also used by the wrapper; must stay in sync with valid_name() in resources/wrapper.sh.
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const KEY_RE = /^[A-Za-z0-9._-]+$/;

function security(args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("security", args, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout);
    });
    if (stdin !== undefined) child.stdin?.end(stdin);
  });
}

// `security -i` reads the command from stdin so the key never shows up in `ps`.
// Name and key are charset-validated, so no quoting is needed.
export async function saveKey(name: string, key: string): Promise<void> {
  if (!NAME_RE.test(name)) throw new Error("Invalid profile name");
  if (!KEY_RE.test(key)) throw new Error("API key contains unexpected characters");
  await security(["-i"], `add-generic-password -U -s ${SERVICE} -a ${name} -w ${key}\n`);
}

export async function deleteKey(name: string): Promise<void> {
  try {
    await security(["delete-generic-password", "-s", SERVICE, "-a", name]);
  } catch {
    // already gone
  }
}
