// ----------------------------------------------------------------------------------------------------------------------
//  <copyright file="server.mjs" company="Curtis Instruments AG">
//  (c) 2026 Curtis Instruments AG, Biberist, Switzerland, www.curtis.ch
//  </copyright>
//
//  <summary>Serves editable React styles and graphics on the demo Node.js host.</summary>
//  <date>06-10-2026</date>
//  <author>rsu - Richard Sumka</author>
// ----------------------------------------------------------------------------------------------------------------------

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dataRoot = resolve(process.env.APPEARANCE_DATA_DIR ||
  join(process.env.HOME || root, "curtis-appearance-data"));
const brands = ["generic", "ottobock", "pride"];
const version = /^[a-f0-9]{64}$/i;
const graphicName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.(png|jpg|jpeg|gif|webp)$/i;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const object = value => value && typeof value === "object" && !Array.isArray(value);

function reject(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function json(response, status, message) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify({ message }));
}

function authorized(request) {
  const token = process.env.APPEARANCE_UPLOAD_TOKEN;
  if (!token || token.length < 24) reject(503, "Upload token is not configured.");
  const supplied = request.headers["x-appearance-upload-key"] || "";
  if (typeof supplied !== "string" ||
      !timingSafeEqual(createHash("sha256").update(token).digest(),
        createHash("sha256").update(supplied).digest()))
    reject(401, "Upload key rejected.");
}

async function requestJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 29 * 1024 * 1024) reject(413, "Package exceeds 29 MB.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { reject(400, "Invalid package JSON."); }
}

// Reject executable CSS here as well as in the app's StyleUpdateResolver.
function checkCss(css) {
  if (typeof css !== "string" || !css.includes("{") || Buffer.byteLength(css) > 512 * 1024 ||
      /[<\\\0]/.test(css) || /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(css))
    reject(400, "Unsafe CSS.");
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (clean.includes("/*") ||
      /\b(url|image-set|expression|behavior|paint)\s*\(|(javascript|vbscript|data)\s*:|(?:^|[;{\s])(?:behavior|-moz-binding)\s*:|@\s*(import|font-face|namespace|document)\b/i.test(clean) ||
      clean.replace(/@\s*(media|keyframes|-webkit-keyframes)\b/gi, "").includes("@"))
    reject(400, "Scripts and external CSS resources are forbidden.");
  let depth = 0, quote = "";
  for (const character of clean) {
    if (quote) { if (character === quote) quote = ""; }
    else if (character === "'" || character === '"') quote = character;
    else if (character === "{") depth++;
    else if (character === "}" && --depth < 0) reject(400, "Unbalanced CSS.");
  }
  if (quote || depth) reject(400, "Unbalanced CSS.");
}

function raster(bytes) {
  return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    bytes.toString("ascii", 0, 4) === "GIF8" ||
    (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
}

function asset(brand, name) {
  const saved = join(dataRoot, brand, name);
  const packaged = join(root, brand, name);
  return readFileSync(existsSync(saved) ? saved : packaged);
}

function saveFile(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    if (!(readFileSync(path)).equals(bytes)) reject(409, "Version folder already contains different data.");
  } else writeFileSync(path, bytes, { flag: "wx" });
}

function publish(input) {
  const m = input?.manifest, styles = m?.styles, graphics = m?.graphics;
  if (!object(m) || !object(styles) || !object(graphics) || !object(input.graphics) ||
      !object(input.expected) || !brands.includes(m.brand) || m.schemaVersion !== 2 ||
      styles.uiContractVersion !== 2 || graphics.uiContractVersion !== 2 ||
      !version.test(styles.version) || !version.test(graphics.version) ||
      !Array.isArray(styles.files) || styles.files.length ||
      !Array.isArray(graphics.files) || graphics.files.length < 1 || graphics.files.length > 100)
    reject(400, "Invalid appearance manifest.");
  checkCss(input.css);
  const css = Buffer.from(input.css);
  if (styles.size !== css.length || styles.sha256 !== hash(css)) reject(400, "CSS differs from manifest.");

  const files = [];
  const names = new Set();
  let total = 0;
  for (const file of graphics.files) {
    const name = file?.name;
    if (typeof name !== "string" || !graphicName.test(name) || name.includes("..") ||
        names.has(name.toLowerCase()) || typeof input.graphics[name] !== "string")
      reject(400, "Invalid graphic name.");
    const encoded = input.graphics[name];
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.length > 5 * 1024 * 1024 || !raster(bytes) ||
        bytes.toString("base64") !== encoded || file.size !== bytes.length || file.sha256 !== hash(bytes))
      reject(400, "Graphic differs from manifest.");
    names.add(name.toLowerCase());
    files.push({ name, bytes });
    total += bytes.length;
  }
  if (total > 20 * 1024 * 1024 || Object.keys(input.graphics).length !== files.length)
    reject(400, "Graphics package is too large or incomplete.");

  const current = JSON.parse(asset(m.brand, "manifest.json"));
  if (input.expected.styles !== current.styles.version ||
      input.expected.graphics !== current.graphics.version)
    reject(409, "Appearance changed on the server. Reload the editor.");

  const manifestBytes = Buffer.from(JSON.stringify(m) + "\n");
  if (manifestBytes.length > 128 * 1024) reject(400, "Manifest exceeds 128 KB.");
  const folder = join(dataRoot, m.brand);
  saveFile(join(folder, "styles", styles.version, "react.css"), css);
  for (const file of files) saveFile(join(folder, "graphics", graphics.version, file.name), file.bytes);

  // The manifest is switched only after all versioned files exist.
  const temporary = join(folder, ".manifest-" + randomUUID() + ".tmp");
  try {
    writeFileSync(temporary, manifestBytes, { flag: "wx" });
    renameSync(temporary, join(folder, "manifest.json"));
  } finally {
    rmSync(temporary, { force: true });
  }
}

function serve(response, brand, name) {
  const allowed = name === "editor.html" || name === "curtis-logo.png" || name === "manifest.json" ||
    /^styles\/[a-f0-9]{64}\/react\.css$/i.test(name) ||
    /^graphics\/[a-f0-9]{64}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.(png|jpg|jpeg|gif|webp)$/i.test(name) && !name.includes("..");
  if (!allowed) reject(404, "Appearance file not found.");
  const bytes = name === "editor.html" || name === "curtis-logo.png"
    ? readFileSync(join(root, brand, name)) : asset(brand, name);
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  const mime = { ".html": "text/html", ".json": "application/json", ".css": "text/css",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp" };
  response.writeHead(200, {
    "Content-Type": mime[extension], "Content-Length": bytes.length,
    // The app verifies hashes; Hostinger's CDN must not alter image bytes.
    "Cache-Control": "private, no-store, no-transform", "X-Content-Type-Options": "nosniff"
  });
  response.end(bytes);
}

// Serve the same Vite output that MAUI packages, with its public fonts and brand images.
function serveReact(response, path) {
  if (path === "/preview/_framework/hybridwebview.js") {
    response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    response.end(); // Browser preview uses the existing mock bridge.
    return;
  }
  const relative = path.startsWith("/preview/") ? path.slice(9) : path.slice(1);
  if (!/^[A-Za-z0-9_./-]+$/.test(relative) || relative.split("/").some(part => !part || part === "." || part === ".."))
    reject(404, "React preview file not found.");
  const extension = relative.slice(relative.lastIndexOf(".")).toLowerCase();
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
    ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2" };
  if (!mime[extension]) reject(404, "React preview file not found.");
  const bytes = readFileSync(join(root, "preview", relative));
  response.writeHead(200, { "Content-Type": mime[extension], "Content-Length": bytes.length,
    "Cache-Control": "private, no-store, no-transform", "X-Content-Type-Options": "nosniff" });
  response.end(bytes);
}

export const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    if (request.method === "GET" && path === "/") {
      const page = readFileSync(join(root, "index.html"));
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8",
        "Content-Length": page.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      response.end(page);
    } else if (request.method === "POST" && path === "/ReactAppearance/api/publish") {
      authorized(request);
      publish(await requestJson(request));
      json(response, 200, "Appearance published.");
    } else if (request.method === "GET" && (path.startsWith("/preview/") || path.startsWith("/brands/") || path.startsWith("/fonts/"))) {
      serveReact(response, path);
    } else if (request.method === "GET") {
      const match = /^\/ReactAppearance\/(generic|ottobock|pride)\/(.+)$/.exec(path);
      if (!match) reject(404, "Appearance file not found.");
      serve(response, match[1], match[2]);
    } else reject(405, "Method not allowed.");
  } catch (error) {
    if (error.code === "ENOENT") error.status = 404;
    if (!error.status) console.error("[AppearanceServer] Request failed:", error);
    json(response, error.status || 500, error.status ? error.message : "Appearance request failed.");
  }
});

// Hostinger imports this file, so the listener starts without a main-module guard.
server.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
