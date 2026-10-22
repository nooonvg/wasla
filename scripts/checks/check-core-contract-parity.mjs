#!/usr/bin/env node
// Purpose: prove that the CORE event contracts copied into docs/contracts/core/
//   are byte-identical to their source of truth in nooonvg/wasla-core@main,
//   and that PROVENANCE.md records every copied file with no orphans and no
//   missing entries (XR-3.6, shared ecosystem roadmap Revision 7).
//   Mirrors the pattern of docs/ecosystem/check-ecosystem-sync.mjs (XR-0.1).
//
// Usage:
//   node scripts/checks/check-core-contract-parity.mjs            # strict: fetch wasla-core@main, byte-compare
//   node scripts/checks/check-core-contract-parity.mjs --offline  # local structure check only (no network)
//
// No dependencies: Node >= 18 (global fetch).
//
// What it checks:
//  1) Every *.schema.json under docs/contracts/core/ parses as JSON.
//  2) Every copied file is listed in PROVENANCE.md's transfer table and vice
//     versa — no orphans, no missing entries.
//  3) PROVENANCE.md records the source repo, commit, and path.
//  4) Strict mode: each local file's SHA-256 equals the fetched
//     wasla-core@main/contracts/events/<name> content (byte-identical).

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCAL_DIR = join(ROOT, "docs", "contracts", "core");
const PROVENANCE = join(LOCAL_DIR, "PROVENANCE.md");
const SOURCE_REPO = "nooonvg/wasla-core";
const SOURCE_REF = process.env.CORE_CONTRACT_PARITY_REF || "main";
const SOURCE_PATH = "contracts/events";
const offline = process.argv.includes("--offline");

const sha = (text) => createHash("sha256").update(text).digest("hex");
const problems = [];

// ── 1) The local copies exist, parse, and are non-empty ─────────────────────
const localFiles = readdirSync(LOCAL_DIR)
  .filter((name) => name.endsWith(".schema.json"))
  .sort();
if (localFiles.length === 0) {
  problems.push("docs/contracts/core/: no *.schema.json files found");
}
const localHashes = new Map();
for (const name of localFiles) {
  const text = readFileSync(join(LOCAL_DIR, name), "utf8");
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) {
      problems.push(`${name}: parsed JSON is not an object`);
    }
  } catch (error) {
    problems.push(`${name}: JSON parse error ${error.message}`);
    continue;
  }
  localHashes.set(name, sha(text));
}

// ── 2) PROVENANCE lists exactly these files, with source fields ────────────
const provenance = readFileSync(PROVENANCE, "utf8");
const listed = new Set();
for (const match of provenance.matchAll(/`([a-z0-9._]+\.schema\.json)`/g)) {
  listed.add(match[1]);
}
for (const name of localFiles) {
  if (!listed.has(name)) {
    problems.push(`PROVENANCE.md does not list copied file: ${name}`);
  }
}
for (const name of listed) {
  if (!localFiles.includes(name)) {
    problems.push(`PROVENANCE.md lists a file that does not exist locally: ${name}`);
  }
}
if (!provenance.includes(SOURCE_REPO)) {
  problems.push("PROVENANCE.md does not record the source repository");
}
if (!provenance.includes(SOURCE_PATH)) {
  problems.push("PROVENANCE.md does not record the source path");
}
if (!/[0-9a-f]{40}/.test(provenance)) {
  problems.push("PROVENANCE.md does not record a full source commit SHA");
}

// ── 3) Strict mode: byte-identity with wasla-core@main ──────────────────────
if (!offline) {
  for (const name of localFiles) {
    const url = `https://raw.githubusercontent.com/${SOURCE_REPO}/${SOURCE_REF}/${SOURCE_PATH}/${name}`;
    let remote;
    try {
      const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
      if (res.status === 404) {
        problems.push(`${SOURCE_REPO}@${SOURCE_REF}: ${SOURCE_PATH}/${name} does not exist`);
        continue;
      }
      if (!res.ok) {
        problems.push(`${SOURCE_REPO}@${SOURCE_REF}: ${SOURCE_PATH}/${name} fetch failed HTTP ${res.status}`);
        continue;
      }
      remote = await res.text();
    } catch (error) {
      problems.push(`${SOURCE_REPO}@${SOURCE_REF}: ${SOURCE_PATH}/${name} fetch error ${error.message}`);
      continue;
    }
    if (sha(remote) !== localHashes.get(name)) {
      problems.push(
        `${name}: local copy differs from ${SOURCE_REPO}@${SOURCE_REF} — re-copy from source and record the transfer in PROVENANCE.md`,
      );
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`✗ ${problem}`);
  }
  console.error(`عقودُ CORE: ${problems.length} مشكلةً — الدفعُ مرفوضٌ.`);
  process.exit(1);
}

console.log(
  `عقودُ CORE: مطابقةٌ (${localFiles.length} ملفًا${offline ? "، فحصٌ بنيويٌّ محليٌّ" : ` مقابلَ ${SOURCE_REPO}@${SOURCE_REF}`} )`,
);
