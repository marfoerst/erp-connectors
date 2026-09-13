import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadDotenv } from "./env";

let dir: string;
const touched: string[] = [];

function write(contents: string) {
  fs.writeFileSync(path.join(dir, ".env"), contents, "utf8");
}

function track(...keys: string[]) {
  touched.push(...keys);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-env-"));
});

afterEach(() => {
  for (const k of touched) delete process.env[k];
  touched.length = 0;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("loadDotenv", () => {
  it("loads a simple key/value pair", () => {
    write("SW_TEST_A=hello\n");
    track("SW_TEST_A");
    loadDotenv(dir);
    expect(process.env.SW_TEST_A).toBe("hello");
  });

  it("strips surrounding double quotes", () => {
    write('SW_TEST_B="file:./dev.sqlite"\n');
    track("SW_TEST_B");
    loadDotenv(dir);
    expect(process.env.SW_TEST_B).toBe("file:./dev.sqlite");
  });

  it("strips surrounding single quotes", () => {
    write("SW_TEST_C='x'\n");
    track("SW_TEST_C");
    loadDotenv(dir);
    expect(process.env.SW_TEST_C).toBe("x");
  });

  it("keeps '=' inside a value, which base64 keys end with", () => {
    write("SW_TEST_D=abc123==\n");
    track("SW_TEST_D");
    loadDotenv(dir);
    expect(process.env.SW_TEST_D).toBe("abc123==");
  });

  it("ignores comments and blank lines", () => {
    write("# a comment\n\nSW_TEST_E=1\n");
    track("SW_TEST_E");
    loadDotenv(dir);
    expect(process.env.SW_TEST_E).toBe("1");
  });

  it("does NOT override a real environment variable", () => {
    process.env.SW_TEST_F = "from-environment";
    track("SW_TEST_F");
    write("SW_TEST_F=from-file\n");
    loadDotenv(dir);
    expect(process.env.SW_TEST_F).toBe("from-environment");
  });

  it("is a no-op when there is no .env, rather than throwing", () => {
    expect(() => loadDotenv(dir)).not.toThrow();
  });

  it("skips malformed lines with no '='", () => {
    write("JUST_A_WORD\nSW_TEST_G=2\n");
    track("SW_TEST_G");
    loadDotenv(dir);
    expect(process.env.SW_TEST_G).toBe("2");
  });
});
