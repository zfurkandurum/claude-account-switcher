import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type Kind = "sub" | "api";

export interface Profile {
  kind: Kind;
  name: string;
  email?: string;
}

interface Store {
  profiles: Profile[];
  lastNonDefault?: string; // active id, e.g. "api:work"
}

export const MAX = "max";

// Read lazily so tests can point CLAUDE_SWITCHER_DIR at a temp dir.
export const dir = () => process.env.CLAUDE_SWITCHER_DIR ?? path.join(os.homedir(), ".claude-switcher");
export const wrapperPath = () => path.join(dir(), "wrapper.sh");
const activeFile = () => path.join(dir(), "active");
const storeFile = () => path.join(dir(), "profiles.json");

export const idOf = (p: Pick<Profile, "kind" | "name">) => `${p.kind}:${p.name}`;

// Bare names come from v0.1 and meant API profiles.
export function parseId(id: string): { kind: "max" } | Profile {
  if (id === MAX || id === "") return { kind: "max" } as { kind: "max" };
  if (id.startsWith("sub:")) return { kind: "sub", name: id.slice(4) };
  if (id.startsWith("api:")) return { kind: "api", name: id.slice(4) };
  return { kind: "api", name: id };
}

export function accountDir(name: string) {
  return path.join(dir(), "accounts", name);
}

export function apiConfigDir(name: string) {
  return path.join(dir(), "api-config", name);
}

function readStore(): Store {
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), "utf8"));
    if (Array.isArray(raw.profiles)) {
      return { profiles: raw.profiles, lastNonDefault: raw.lastNonDefault };
    }
    // v0.1 format: { apiProfiles: string[], lastApi?: string }
    if (Array.isArray(raw.apiProfiles)) {
      return {
        profiles: raw.apiProfiles.map((name: string) => ({ kind: "api" as const, name })),
        lastNonDefault: raw.lastApi ? `api:${raw.lastApi}` : undefined,
      };
    }
  } catch {
    // missing or corrupt: start empty
  }
  return { profiles: [] };
}

function writeStore(s: Store) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(s, null, 2));
}

export const listProfiles = (): Profile[] => readStore().profiles;

export function upsertProfile(p: Profile) {
  const s = readStore();
  const i = s.profiles.findIndex((x) => x.kind === p.kind && x.name === p.name);
  if (i >= 0) s.profiles[i] = { ...s.profiles[i], ...p };
  else s.profiles.push(p);
  writeStore(s);
}

export function removeProfile(p: Pick<Profile, "kind" | "name">) {
  const s = readStore();
  s.profiles = s.profiles.filter((x) => !(x.kind === p.kind && x.name === p.name));
  if (s.lastNonDefault === idOf(p)) s.lastNonDefault = s.profiles[0] ? idOf(s.profiles[0]) : undefined;
  writeStore(s);
}

export function getActive(): string {
  try {
    return fs.readFileSync(activeFile(), "utf8").trim() || MAX;
  } catch {
    return MAX;
  }
}

export function setActive(id: string) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(activeFile(), id);
  if (id !== MAX) {
    const s = readStore();
    s.lastNonDefault = id;
    writeStore(s);
  }
}

// Target for the Max ⇄ other toggle; v0.1 bare ids are normalised.
export function getLastNonDefault(): string | undefined {
  const s = readStore();
  const known = (id?: string) => !!id && s.profiles.some((p) => idOf(p) === idOf(parseId(id) as Profile));
  if (known(s.lastNonDefault)) return idOf(parseId(s.lastNonDefault!) as Profile);
  return s.profiles[0] ? idOf(s.profiles[0]) : undefined;
}
