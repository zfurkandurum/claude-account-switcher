import { afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getActive,
  getLastNonDefault,
  idOf,
  listProfiles,
  parseId,
  removeProfile,
  setActive,
  upsertProfile,
} from "./profiles";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "switcher-"));
  process.env.CLAUDE_SWITCHER_DIR = tmp;
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("parseId handles max, prefixed and legacy bare ids", () => {
  expect(parseId("max")).toEqual({ kind: "max" });
  expect(parseId("sub:work")).toEqual({ kind: "sub", name: "work" });
  expect(parseId("api:work")).toEqual({ kind: "api", name: "work" });
  expect(parseId("work")).toEqual({ kind: "api", name: "work" });
});

test("active defaults to max and round-trips", () => {
  expect(getActive()).toBe("max");
  setActive("sub:a");
  expect(getActive()).toBe("sub:a");
});

test("same name can exist as both sub and api", () => {
  upsertProfile({ kind: "sub", name: "work", email: "a@b.c" });
  upsertProfile({ kind: "api", name: "work" });
  expect(listProfiles().map(idOf)).toEqual(["sub:work", "api:work"]);
});

test("upsert merges fields and does not duplicate", () => {
  upsertProfile({ kind: "sub", name: "w" });
  upsertProfile({ kind: "sub", name: "w", email: "x@y.z" });
  expect(listProfiles()).toEqual([{ kind: "sub", name: "w", email: "x@y.z" }]);
});

test("v0.1 profiles.json is migrated", () => {
  fs.writeFileSync(path.join(tmp, "profiles.json"), JSON.stringify({ apiProfiles: ["k1", "k2"], lastApi: "k2" }));
  expect(listProfiles().map(idOf)).toEqual(["api:k1", "api:k2"]);
  expect(getLastNonDefault()).toBe("api:k2");
});

test("lastNonDefault tracks switches and survives removal of others", () => {
  upsertProfile({ kind: "api", name: "a" });
  upsertProfile({ kind: "sub", name: "b" });
  setActive("sub:b");
  setActive("max");
  expect(getLastNonDefault()).toBe("sub:b");
  removeProfile({ kind: "sub", name: "b" });
  expect(getLastNonDefault()).toBe("api:a");
});

test("lastNonDefault is undefined with no profiles", () => {
  expect(getLastNonDefault()).toBeUndefined();
});
