// ----------------------------------------------------------------------------------------------------------------------
//  <copyright file="server.test.mjs" company="Curtis Instruments AG">
//  (c) 2026 Curtis Instruments AG, Biberist, Switzerland, www.curtis.ch
//  </copyright>
//
//  <summary>Checks Node.js appearance publishing, history, and rejection of unsafe content.</summary>
//  <date>06-10-2026</date>
//  <author>rsu - Richard Sumka</author>
// ----------------------------------------------------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const token = "test-upload-token-with-at-least-24-chars";

test("Node server serves the exported editor and publishes immutable versions", async () => {
  const output = await mkdtemp(join(tmpdir(), "curtis-node-appearance-"));
  const script = fileURLToPath(new URL("../InteractiveAssist.React/scripts/export-appearance.mjs", import.meta.url));
  const run = spawnSync(process.execPath, [script, "--brand", "Pride", "--output", output], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const root = output;
  const brandRoot = join(root, "ReactAppearance", "pride");
  const initial = JSON.parse(await readFile(join(brandRoot, "manifest.json")));
  process.env.APPEARANCE_DATA_DIR = join(output, "saved-versions");
  process.env.APPEARANCE_UPLOAD_TOKEN = token;
  process.env.PORT = "0";
  const { server } = await import(pathToFileURL(join(root, "server.mjs")));
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(url);
    assert.equal(home.status, 200);
    const chooser = await home.text();
    const exportedAt = JSON.parse(await readFile(join(root, "build-info.json"))).exportedAt;
    assert.ok(chooser.includes(exportedAt));
    for (const brand of ["pride", "generic", "ottobock"])
      assert.match(chooser, new RegExp("/ReactAppearance/" + brand + "/editor.html"));
    const editor = await fetch(`${url}/ReactAppearance/pride/editor.html`);
    assert.equal(editor.status, 200);
    assert.match(await editor.text(), /Save to server/);
    const appResponse = await fetch(`${url}/preview/index.html?appearancePreview=1&brand=pride`);
    assert.equal(appResponse.status, 200);
    const appHtml = await appResponse.text();
    const script = appHtml.match(/\.\/vite_generated\/[^" ]+\.js/)?.[0];
    assert.ok(script, "Vite must export the real React app.");
    assert.equal((await fetch(`${url}/preview/${script.slice(2)}`)).status, 200);
    assert.equal((await fetch(`${url}/brands/pride/top_bar_logo.png`)).status, 200);
    assert.equal((await fetch(`${url}/fonts/WorkSansRegular.ttf`)).status, 200);
    assert.equal((await fetch(`${url}/preview/vite_generated/hidden.js.map`)).status, 404);
    const manifestResponse = await fetch(`${url}/ReactAppearance/pride/manifest.json`);
    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get("content-type"), /application\/json/);
    const originalGraphic = initial.graphics.files[0];
    const graphicResponse = await fetch(`${url}/ReactAppearance/pride/graphics/${initial.graphics.version}/${originalGraphic.name}`);
    assert.match(graphicResponse.headers.get("cache-control"), /no-transform/);
    const css = (await readFile(join(brandRoot, "styles", initial.styles.version, "react.css"), "utf8")) + "\nbody{color:#123456}\n";
    const images = Object.fromEntries(await Promise.all(initial.graphics.files.map(async file =>
      [file.name, (await readFile(join(brandRoot, "graphics", initial.graphics.version, file.name))).toString("base64")])));
    const next = structuredClone(initial);
    next.styles.version = "a".repeat(64);
    next.styles.sha256 = hash(css);
    next.styles.size = Buffer.byteLength(css);
    const payload = { manifest: next, css, graphics: images,
      expected: { styles: initial.styles.version, graphics: initial.graphics.version } };
    const publish = async (value, key = token) => fetch(`${url}/ReactAppearance/api/publish`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Appearance-Upload-Key": key },
      body: JSON.stringify(value)
    });
    assert.equal((await publish(payload, "wrong-key")).status, 401);
    assert.equal((await publish({ ...payload, css: "body{background:url(evil)}" })).status, 400);
    assert.equal((await publish(payload)).status, 200);
    assert.equal((await publish(payload)).status, 409);
    assert.equal((await stat(join(brandRoot, "styles", initial.styles.version, "react.css"))).isFile(), true);
    assert.equal((await readFile(join(output, "saved-versions", "pride", "styles", next.styles.version, "react.css"), "utf8")), css);
    assert.deepEqual(await (await fetch(`${url}/ReactAppearance/pride/manifest.json`)).json(), next);
    assert.equal((await fetch(`${url}/ReactAppearance/pride/styles/${next.styles.version}/react.css`)).status, 200);
    assert.equal((await fetch(`${url}/ReactAppearance/pride/reference/react.css`)).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(output, { recursive: true, force: true });
    delete process.env.APPEARANCE_DATA_DIR;
    delete process.env.APPEARANCE_UPLOAD_TOKEN;
    delete process.env.PORT;
  }
});
