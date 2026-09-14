import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const packageDirectory = path.resolve(__dirname, "../../");

describe("nono profile localization", () => {
  it("defines the profile setting and command in every package locale", () => {
    const localeFiles = readdirSync(packageDirectory).filter((file) => /^package\.nls(?:\..+)?\.json$/.test(file));

    expect(localeFiles.length).toBeGreaterThan(1);
    for (const file of localeFiles) {
      const locale = JSON.parse(readFileSync(path.join(packageDirectory, file), "utf8")) as Record<string, unknown>;
      expect(locale, file).toMatchObject({
        "configuration.nonoProfile": expect.any(String),
        "command.selectNonoProfile": expect.any(String),
        "command.checkForUpdates": expect.any(String),
      });
    }
  });
});
