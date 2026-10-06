// ----------------------------------------------------------------------------------------------------------------------
//  <copyright file="server.mjs" company="Curtis Instruments AG">
//  (c) 2026 Curtis Instruments AG, Biberist, Switzerland, www.curtis.ch
//  </copyright>
//
//  <summary>Serves and publishes versioned React appearance files on a Node.js host.</summary>
//  <date>06-10-2026</date>
//  <author>rsu - Richard Sumka</author>
// ----------------------------------------------------------------------------------------------------------------------

import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dataRoot = resolve(process.env.APPEARANCE_DATA_DIR || join(root, "data"));
const brands = new Set(["generic", "ottobock", "pride"]);
const versionPattern = /^[a-f0-9]{64}$/i;
const graphicPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.(?:png|jpe?g|gif|webp)$/i;
const maxBody = 29 * 1024 * 1024;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };

function reply(response, status, message) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify({ message }));
}

function authorized(request) {
  const secret = process.env.APPEARANCE_UPLOAD_TOKEN;
  if (!secret || secret.length < 24) fail(503, "Upload endpoint is not configured.");
  const supplied = request.headers["x-appearance-upload-key"] || "";
  if (typeof supplied !== "string") fail(401, "Upload key rejected.");
  const a = createHash("sha256").update(secret).digest();
  const b = createHash("sha256").update(supplied).digest();
  if (!timingSafeEqual(a, b)) fail(401, "Upload key rejected.");
}

async function body(request) {
  const parts = [];
  let size = 0;
  for await (const part of request) {
    size += part.length;
    if (size > maxBody) fail(413, "Package exceeds 29 MB.");
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { fail(400, "Invalid package JSON."); }
}

function validateCss(css) {
  if (typeof css !== "string" || !css.includes("{") || Buffer.byteLength(css) < 1 || Buffer.byteLength(css) > 512 * 1024 ||
      /[<\\\0]/.test(css) || /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(css))
    fail(400, "Unsafe or oversized CSS.");
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (clean.includes("/*") || /\b(?:url|image-set|expression|behavior|paint)\s*\(|(?:javascript|vbscript|data)\s*:|(?:^|[;{\s])(?:behavior|-moz-binding)\s*:|@\s*(?:import|font-face|namespace|document)\b/i.test(clean) ||
      clean.replace(/@\s*(?:media|keyframes|-webkit-keyframes)\b/gi, "").includes("@"))
    fail(400, "Executable or external CSS is forbidden.");
  let depth = 0, quote = "";
  for (const character of clean) {
    if (quote) { if (character === quote) quote = ""; }
    else if (character === "'" || character === '"') quote = character;
    else if (character === "{") depth++;
    else if (character === "}" && --depth < 0) fail(400, "Unbalanced CSS.");
  }
  if (quote || depth) fail(400, "Unbalanced CSS.");
}

function raster(bytes) {
  return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    bytes.toString("ascii", 0, 4) === "GIF8" ||
    (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
}

function validate(input) {
  if (!object(input) || !object(input.manifest) || !object(input.manifest.styles) ||
      !object(input.manifest.graphics) || !object(input.graphics) || !object(input.expected))
    fail(400, "Invalid package object.");
  const { manifest, css, graphics, expected } = input;
  const { brand, styles, graphics: graphicPackage } = manifest;
  if (!brands.has(brand) || manifest.schemaVersion !== 2) fail(400, "Unknown brand or schema.");
  if (styles.uiContractVersion !== 2 || graphicPackage.uiContractVersion !== 2)
    fail(400, "Incompatible appearance contract.");
  if (!versionPattern.test(styles.version) || !versionPattern.test(graphicPackage.version) ||
      !Array.isArray(styles.files) || styles.files.length !== 0 || !Array.isArray(graphicPackage.files) ||
      graphicPackage.files.length < 1 || graphicPackage.files.length > 100)
    fail(400, "Invalid appearance versions or file list.");
  validateCss(css);
  const cssBytes = Buffer.from(css);
  if (styles.size !== cssBytes.length || styles.sha256?.toLowerCase() !== hash(cssBytes))
    fail(400, "CSS differs from manifest.");
  const images = new Map();
  let total = 0;
  for (const file of graphicPackage.files) {
    if (!object(file) || !graphicPattern.test(file.name) || file.name.includes("..") ||
        images.has(file.name.toLowerCase()) || typeof graphics[file.name] !== "string")
      fail(400, "Unsafe or duplicate graphic name.");
    const encoded = graphics[file.name];
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
      fail(400, "Invalid graphic data.");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded || !raster(bytes) || bytes.length < 1 || bytes.length > 5 * 1024 * 1024 ||
        bytes.length !== file.size || file.sha256?.toLowerCase() !== hash(bytes))
      fail(400, "Graphic differs from manifest.");
    total += bytes.length;
    if (total > 20 * 1024 * 1024) fail(400, "Graphics exceed 20 MB.");
    images.set(file.name.toLowerCase(), { name: file.name, bytes });
  }
  if (Object.keys(graphics).length !== images.size) fail(400, "Graphics list differs from manifest.");
  const manifestBytes = Buffer.from(JSON.stringify(manifest) + "\n");
  if (manifestBytes.length > 128 * 1024) fail(400, "Manifest exceeds 128 KB.");
  if (!versionPattern.test(expected.styles) || !versionPattern.test(expected.graphics))
    fail(400, "Invalid previous versions.");
  return { brand, styles, graphicPackage, cssBytes, images, manifestBytes, expected };
}

async function readCurrent(brand) {
  for (const path of [join(dataRoot, brand, "manifest.json"), join(root, brand, "manifest.json")]) {
    try { return JSON.parse(await readFile(path, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  fail(404, "Brand has no published manifest.");
}

async function writeImmutable(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  try {
    const file = await open(path, "wx");
    try { await file.writeFile(bytes); } finally { await file.close(); }
  } catch (error) {
    if (error.code !== "EEXIST" || !(await readFile(path)).equals(bytes)) throw error;
  }
}

// Serialize publishes so two editors cannot both pass the same version check.
let publishing = Promise.resolve();
function publish(request, response) {
  const job = publishing.then(async () => {
    authorized(request);
    const input = validate(await body(request));
    const { brand, styles, graphicPackage, cssBytes, images, manifestBytes, expected } = input;
    const current = await readCurrent(brand);
    if (current.styles?.version !== expected.styles || current.graphics?.version !== expected.graphics)
      fail(409, "Appearance changed on the server. Reload the editor.");
    const target = join(dataRoot, brand);
    await writeImmutable(join(target, "styles", styles.version, "react.css"), cssBytes);
    for (const { name, bytes } of images.values())
      await writeImmutable(join(target, "graphics", graphicPackage.version, name), bytes);
    await mkdir(target, { recursive: true });
    const temporary = join(target, `.manifest-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, manifestBytes, { flag: "wx" });
      await rename(temporary, join(target, "manifest.json"));
    } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
    reply(response, 200, "Appearance published.");
  });
  publishing = job.catch(() => {});
  return job;
}

const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

async function serve(request, response, pathname) {
  const match = /^\/ReactAppearance\/(generic|ottobock|pride)\/(.+)$/.exec(pathname);
  if (!match) fail(404, "Appearance file not found.");
  const [, brand, suffix] = match;
  const allowed = suffix === "manifest.json" || suffix === "editor.html" || suffix === "curtis-logo.png" ||
    /^styles\/[a-f0-9]{64}\/react\.css$/i.test(suffix) ||
    /^graphics\/[a-f0-9]{64}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.(?:png|jpe?g|gif|webp)$/i.test(suffix) && !suffix.includes("..");
  if (!allowed) fail(404, "Appearance file not found.");
  const paths = suffix === "editor.html" || suffix === "curtis-logo.png"
    ? [join(root, brand, suffix)]
    : [join(dataRoot, brand, suffix), join(root, brand, suffix)];
  for (const path of paths) {
    try {
      const details = await stat(path);
      if (!details.isFile()) continue;
      const extension = path.slice(path.lastIndexOf("."));
      response.writeHead(200, { "Content-Type": mime[extension], "Content-Length": details.size,
        "Cache-Control": suffix === "manifest.json" ? "no-store" : "public, max-age=3600",
        "X-Content-Type-Options": "nosniff" });
      createReadStream(path).pipe(response);
      return;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  fail(404, "Appearance file not found.");
}

export const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/" && request.method === "GET") {
      response.writeHead(302, { Location: "/ReactAppearance/pride/editor.html" }); response.end();
    } else if (pathname === "/ReactAppearance/api/publish" && request.method === "POST") {
      await publish(request, response);
    } else if (request.method === "GET") {
      await serve(request, response, pathname);
    } else fail(405, "Method not allowed.");
  } catch (error) {
    if (!response.headersSent) reply(response, error.status || 500, error.status ? error.message : "Could not process appearance request.");
    if (!error.status) console.error("[AppearanceServer] Request failed:", error);
  }
});

// Hostinger imports the entry file and expects listen() during module evaluation.
const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () =>
  console.log(`[AppearanceServer] Listening on port ${server.address().port}; data=${dataRoot}`));
