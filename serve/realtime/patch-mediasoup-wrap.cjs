#!/usr/bin/env node
// Rewrite mediasoup's meson wrap files so all dependency downloads go through
// a GitHub proxy (gh-proxy.com by default) instead of upstream sources that are
// often blocked/timeout in CN networks:
//   - wrapdb.mesonbuild.com (WrapDB patch endpoint)
//   - dist.libuv.org, www.openssl.org (upstream source tarballs)
//   - github.com (already GitHub, just needs proxy prefix)
//
// For each .wrap file we:
//   1) turn patch_url (wrapdb v2 API) into the corresponding GitHub wrapdb
//      release asset URL (the v2 API just redirects there anyway), then prefix
//      with the proxy
//   2) prefix any remaining github.com URL with the proxy
//   3) replace non-GitHub source_url with its source_fallback_url (GitHub) when
//      available, prefixed with the proxy; if no fallback exists, prefix the
//      original with the proxy too (best effort)
//
// Usage: node patch-mediasoup-wrap.cjs [ghproxy-prefix]
//   default prefix: https://gh-proxy.com
const fs = require("node:fs");
const path = require("node:path");

const ghproxy = (process.argv[2] || "https://gh-proxy.com").replace(/\/+$/, "");
const wrapDir = path.join(
  process.cwd(),
  "node_modules",
  "mediasoup",
  "worker",
  "subprojects",
);

if (!fs.existsSync(wrapDir)) {
  console.error(`[patch-wrap] subprojects dir not found: ${wrapDir}`);
  process.exit(1);
}

// Idempotent: if URL already starts with the proxy prefix, return as-is.
// This prevents double-prefixing when the script is run multiple times
// (e.g. on stale node_modules from a previous failed build).
const gh = (url) => {
  if (url.startsWith(ghproxy + "/")) return url;
  return `${ghproxy}/${url}`;
};

// Parse a simple .wrap file into key/value pairs per section.
function parseWrap(content) {
  const sections = {};
  let current = null;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      current = sec[1];
      sections[current] = sections[current] || {};
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (kv && current) {
      sections[current][kv[1]] = kv[2];
    }
  }
  return sections;
}

function patchWrapFile(file) {
  const full = path.join(wrapDir, file);
  if (!fs.existsSync(full)) return false;
  let content = fs.readFileSync(full, "utf8");
  const sections = parseWrap(content);
  const wrap = sections["wrap-file"];
  if (!wrap) return false;

  const patchFilename = wrap.patch_filename || "";
  // patch_url looks like: https://wrapdb.mesonbuild.com/v2/<release_tag>/get_patch
  // where <release_tag> is the same tag used in github wrapdb releases (e.g.
  // "libuv_1.51.0-1"). Extract it rather than using wrapdb_version, because the
  // release tag includes the package name prefix.
  const patchTagMatch = (wrap.patch_url || "").match(/\/v2\/([^/]+)\/get_patch$/);
  const releaseTag = patchTagMatch ? patchTagMatch[1] : wrap.wrapdb_version || "";
  // source_fallback_url already points to github wrapdb releases
  const fallback = wrap.source_fallback_url || "";

  // 1) patch_url: wrapdb v2 API -> github wrapdb release asset (proxied)
  if (wrap.patch_url && releaseTag && patchFilename) {
    const githubPatch = `https://github.com/mesonbuild/wrapdb/releases/download/${releaseTag}/${patchFilename}`;
    content = content.split(wrap.patch_url).join(gh(githubPatch));
  }

  // 2) source_fallback_url: prefix github url with proxy
  if (fallback && fallback.startsWith("https://github.com/")) {
    content = content.split(fallback).join(gh(fallback));
  }

  // 3) source_url: if it's a non-github host, prefer the (proxied) github
  //    fallback; otherwise just proxy-prefix it.
  const sourceUrl = wrap.source_url || "";
  if (sourceUrl && !sourceUrl.startsWith("https://github.com/")) {
    if (fallback) {
      // already replaced fallback above to proxied version; point source_url to
      // the same proxied github asset so meson doesn't even try the blocked host
      content = content.split(sourceUrl).join(gh(fallback));
    } else {
      content = content.split(sourceUrl).join(gh(sourceUrl));
    }
  } else if (sourceUrl && sourceUrl.startsWith("https://github.com/")) {
    content = content.split(sourceUrl).join(gh(sourceUrl));
  }

  fs.writeFileSync(full, content);
  console.log(`[patch-wrap] rewrote ${file}`);
  return true;
}

const wrapFiles = fs
  .readdirSync(wrapDir)
  .filter((f) => f.endsWith(".wrap"));

let count = 0;
for (const f of wrapFiles) {
  if (patchWrapFile(f)) count += 1;
}
console.log(`[patch-wrap] done: ${count} wrap file(s) patched (ghproxy=${ghproxy})`);
