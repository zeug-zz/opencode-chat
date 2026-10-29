import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspaceRequire = createRequire(path.resolve("packages/platforms/vscode/package.json"));
const mermaidEntry = workspaceRequire.resolve("mermaid");
const mermaidRequire = createRequire(mermaidEntry);
const mermaidPackage = JSON.parse(readFileSync(path.resolve(path.dirname(mermaidEntry), "..", "package.json"), "utf8"));
const katexEntry = mermaidRequire.resolve("katex");
const katexModule = await import(pathToFileURL(katexEntry).href);
const katex = katexModule.default;

assert.equal(katex.version, "0.18.11", "Mermaid must resolve patched KaTeX 0.18.11");
assert.equal(typeof katex.renderToString, "function", "Mermaid's KaTeX default export must expose renderToString");

const mermaidChunksDirectory = path.join(path.dirname(mermaidEntry), "chunks", "mermaid.core");
const consumerFile = readdirSync(mermaidChunksDirectory)
  .filter((file) => file.endsWith(".mjs"))
  .map((file) => path.join(mermaidChunksDirectory, file))
  .find((file) => {
    const source = readFileSync(file, "utf8");
    return source.includes('await import("katex")') && source.includes("katex.renderToString(c, {");
  });

assert.ok(consumerFile, "Mermaid core must retain its KaTeX renderToString consumer");
const consumerSource = readFileSync(consumerFile, "utf8");
assert.match(
  consumerSource,
  /katex\.renderToString\(c,\s*\{\s*throwOnError:\s*true,\s*displayMode:\s*true,\s*output:\s*outputMode/s,
  "Mermaid must keep the tested renderToString options",
);
assert.match(consumerSource, /"mathml"/);
assert.match(consumerSource, /"htmlAndMathml"/);

function renderAsMermaidDoes(c, output) {
  return katex
    .renderToString(c, { throwOnError: true, displayMode: true, output })
    .replace(/\n/g, " ")
    .replace(/<annotation.*<\/annotation>/g, "");
}

function renderWithUntrustedCommands(c, output, trust) {
  return katex
    .renderToString(c, { throwOnError: true, displayMode: true, output, trust })
    .replace(/\n/g, " ")
    .replace(/<annotation.*<\/annotation>/g, "");
}

for (const output of ["mathml", "htmlAndMathml"]) {
  const validMath = renderAsMermaidDoes("x^2 + 1", output);
  assert.match(validMath, /<math\b/, `${output} output must retain MathML`);
  assert.match(validMath, /<msup>/, `${output} output must retain the rendered expression`);
  assert.doesNotMatch(validMath, /<annotation\b/, `${output} output must match Mermaid's annotation removal`);

  if (output === "mathml") {
    assert.doesNotMatch(validMath, /katex-html/, "mathml output must not unexpectedly include HTML rendering");
  } else {
    assert.match(validMath, /katex-html/, "htmlAndMathml output must retain the HTML rendering");
  }

  for (const trust of [undefined, false]) {
    for (const command of [String.raw`\href{javascript:alert(1)}{click}`, String.raw`\url{javascript:alert(1)}`]) {
      const rendered =
        trust === undefined
          ? renderAsMermaidDoes(command, output)
          : renderWithUntrustedCommands(command, output, trust);
      assert.doesNotMatch(rendered, /<a\b[^>]*\bhref\s*=/i, `${output} must not emit an active link for ${command}`);
      assert.doesNotMatch(rendered, /javascript:/i, `${output} must not preserve an executable URL for ${command}`);
    }
  }
}

console.log(
  `Mermaid ${mermaidPackage.version} uses KaTeX ${katex.version}; both render modes and trust-negative cases passed.`,
);
