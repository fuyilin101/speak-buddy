#!/usr/bin/env node
/**
 * Deterministic Codex -> Genesis transport.
 *
 * Codex creates the review packet from the repository it can actually inspect;
 * this script validates the packet and delegates every network call to the
 * existing genesis-connector.mjs. Genesis itself never calls an LLM.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CONNECTOR = join(ROOT, "agent", "genesis-connector.mjs");
const MAX_REVIEW_BYTES = 256 * 1024;
const REQUIRED_DETAIL_KEYS = ["completed_work", "problems", "solutions", "learned", "reusable_assets", "next_steps"];

function fail(message, code = 2) {
  console.error(`Genesis 同步失败：${message}`);
  process.exitCode = code;
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--review-file") {
      options.reviewFile = argv[++i];
      if (!options.reviewFile) throw new Error("Missing value for --review-file.");
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return "Usage: node agent/genesis-sync.mjs --review-file <Codex review JSON> [--dry-run]";
}

function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isNonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
function assertString(value, field, max, required = false) {
  if (value == null || value === "") {
    if (required) throw new Error(`${field} is required.`);
    return;
  }
  if (typeof value !== "string" || value.length > max) throw new Error(`${field} must be a string of at most ${max} characters.`);
}
function assertArray(value, field, maxItems = 100) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  if (value.length > maxItems) throw new Error(`${field} contains too many items.`);
}
function assertEvidence(value, field) {
  assertArray(value, field, 100);
  if (value.length === 0) throw new Error(`${field} 不能为空，请附上实际文件、提交或验证证据。`);
  for (const [index, item] of value.entries()) {
    if (!isObject(item)) throw new Error(`${field}[${index}] must be an object.`);
    assertString(item.path || item.commit || item.command || item.note, `${field}[${index}] evidence`, 1000, true);
  }
}
function validateReview(review) {
  if (!isObject(review)) throw new Error("Review packet must be a JSON object.");
  if (!isObject(review.project)) throw new Error("project is required.");
  const project = review.project;
  assertString(project.source_ref, "project.source_ref", 300, true);
  assertString(project.name, "project.name", 160, true);
  assertString(project.description, "project.description", 4000);
  assertString(project.repo_path, "project.repo_path", 500);
  assertString(project.git_commit, "project.git_commit", 200);
  assertEvidence(project.evidence, "project.evidence");
  assertArray(project.next_steps, "project.next_steps", 100);

  const growth = Array.isArray(review.growth) ? review.growth : [review.growth];
  if (!growth.length || !growth[0]) throw new Error("At least one growth record is required.");
  growth.forEach((record, index) => {
    if (!isObject(record)) throw new Error(`growth[${index}] must be an object.`);
    assertString(record.source_ref, `growth[${index}].source_ref`, 300, true);
    assertString(record.title, `growth[${index}].title`, 200, true);
    assertString(record.content, `growth[${index}].content`, 24000);
    if (!isObject(record.details)) throw new Error(`growth[${index}].details is required.`);
    for (const key of REQUIRED_DETAIL_KEYS) {
      assertArray(record.details[key], `growth[${index}].details.${key}`, 100);
    }
    assertEvidence(record.evidence, `growth[${index}].evidence`);
  });

  const assets = review.assets == null ? [] : review.assets;
  assertArray(assets, "assets", 100);
  assets.forEach((asset, index) => {
    if (!isObject(asset)) throw new Error(`assets[${index}] must be an object.`);
    assertString(asset.source_ref, `assets[${index}].source_ref`, 300, true);
    assertString(asset.title, `assets[${index}].title`, 200, true);
    assertString(asset.content, `assets[${index}].content`, 24000, true);
    assertEvidence(asset.evidence, `assets[${index}].evidence`);
  });
  return { ...review, growth, assets };
}

async function readReview(file) {
  const raw = await readFile(file);
  if (raw.byteLength > MAX_REVIEW_BYTES) throw new Error(`Review packet exceeds ${MAX_REVIEW_BYTES} bytes.`);
  let review;
  try { review = JSON.parse(raw.toString("utf8")); } catch (error) { throw new Error(`Review packet is not valid JSON: ${error.message}`); }
  return validateReview(review);
}

function connector(operation, file, extraEnv = {}) {
  let output;
  try { output = execFileSync(process.execPath, [CONNECTOR, operation, ...(file ? ["--file", file] : [])], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }); } catch (error) { throw new Error(`${operation} 失败：${String(error.stderr || '网络请求或认证失败。').trim()}`); }
  try { return JSON.parse(output); } catch (error) { throw new Error(`${operation} returned invalid JSON: ${error.message}`); }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  if (!options.reviewFile) throw new Error(`--review-file is required. ${usage()}`);
  const review = await readReview(options.reviewFile);
  if (options.dryRun) {
    console.log(JSON.stringify({ valid: true, project: review.project.name, growthRecords: review.growth.length, assets: review.assets.length }, null, 2));
    return;
  }
  const temp = await mkdtemp(join(tmpdir(), "genesis-sync-"));
  try {
    const projectFile = join(temp, "project.json");
    await writeFile(projectFile, JSON.stringify(review.project), "utf8");
    const projectResponse = connector("genesis_save_project", projectFile);
    if (!projectResponse?.success || !projectResponse.project?.id) throw new Error("genesis_save_project did not return a confirmed project ID.");
    const projectId = projectResponse.project.id;
    const growthResponses = [];
    for (const [index, record] of review.growth.entries()) {
      const file = join(temp, `growth-${index}.json`);
      await writeFile(file, JSON.stringify({ ...record, project_id: record.project_id || projectId }), "utf8");
      const response = connector("genesis_add_growth", file);
      if (!response?.success || !response.record?.id) throw new Error('成长记录未返回成功确认和记录 ID。');
      growthResponses.push(response);
    }
    const assetResponses = [];
    for (const [index, asset] of review.assets.entries()) {
      const file = join(temp, `asset-${index}.json`);
      await writeFile(file, JSON.stringify({ ...asset, project_id: asset.project_id || projectId }), "utf8");
      const response = connector("genesis_save_asset", file);
      if (!response?.success || !response.asset?.id) throw new Error('资产未返回成功确认和资产 ID。');
      assetResponses.push(response);
    }
    console.log(JSON.stringify({ success: true, project: projectResponse, growth: growthResponses, assets: assetResponses }, null, 2));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => fail(error.message || "Unexpected error", 1));
