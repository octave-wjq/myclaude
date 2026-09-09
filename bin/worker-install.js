"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const REPO = "octave-wjq/myclaude";
const START = "<!-- myclaude-worker:start -->";
const END = "<!-- myclaude-worker:end -->";
const WORKERS = ["work", "develop", "explore", "code-explorer", "code-architect", "code-reviewer", "oracle", "librarian", "frontend-ui-ux-engineer", "document-writer"];

function assetName(platform, arch) {
  const arches = { x64: "amd64", arm64: "arm64" };
  const systems = { linux: "linux", darwin: "darwin", win32: "windows" };
  if (!arches[arch] || !systems[platform]) throw new Error(`Unsupported platform: ${platform}/${arch}`);
  return `codeagent-wrapper-${systems[platform]}-${arches[arch]}${platform === "win32" ? ".exe" : ""}`;
}

async function readOptional(file) {
  try { return await fs.readFile(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function parseObject(bytes, label) {
  const value = bytes === null ? {} : JSON.parse(bytes.toString());
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${label} must be a JSON object`);
  return value;
}

function workerDefaults(config, models) {
  if (models.agents !== undefined) parseObject(Buffer.from(JSON.stringify(models.agents)), "models.agents");
  const nextConfig = { ...config, backend: "grok" };
  delete nextConfig.model; // Backend defaults must not leak into explicit backend selections.
  const agents = { ...models.agents };
  for (const name of WORKERS) {
    if (name !== "work" && !agents[name]) continue;
    agents[name] = { ...agents[name], backend: "grok", model: "grok-4.6", reasoning: "low", yolo: false };
  }
  return [nextConfig, { ...models, default_backend: "grok", default_model: "grok-4.6", agents }];
}

function managedInstructions(current, binary) {
  const block = `${START}\n## Codeagent worker\nClaude orchestrates; delegate each bounded implementation AND its tests in one call to the codeagent skill. The installed command is ${JSON.stringify(binary)}. Default worker: Grok 4.6, low effort, at most 3 concurrent workers. This setting replaces older myclaude worker defaults that selected Codex/gpt-5. Use an explicit backend only when requested. Workers execute directly and never delegate again. Preserve unrelated files; report actual tests and errors. Grok auto permission mode keeps safety checks.\n${END}`;
  const begin = current.indexOf(START);
  const end = current.indexOf(END);
  if (begin < 0 && end < 0) return `${current.trimEnd()}\n\n${block}\n`.trimStart();
  if (begin < 0 || end < begin) throw new Error("Malformed myclaude instruction markers; repair before updating");
  return current.slice(0, begin) + block + current.slice(end + END.length);
}

async function atomicWrite(file, bytes, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.myclaude-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(temp, bytes, { mode });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}

async function download(url, destination) {
  await run("curl", ["--fail", "--location", "--silent", "--show-error", "--connect-timeout", "10", "--max-time", "120", "--output", destination, url], { timeout: 125000 });
}

async function stageBinary({ repoRoot, stage, tag, buildFromSource, platform, arch }, deps) {
  const binary = path.join(stage, assetName(platform, arch));
  if (buildFromSource) {
    await deps.run("go", ["build", "-ldflags", `-s -w -X codeagent-wrapper/internal/app.version=${tag}`, "-o", binary, "./cmd/codeagent-wrapper"], { cwd: path.join(repoRoot, "codeagent-wrapper") });
  } else {
    const base = `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}`;
    const sums = path.join(stage, "SHA256SUMS");
    await deps.download(`${base}/SHA256SUMS`, sums);
    await deps.download(`${base}/${path.basename(binary)}`, binary);
    const entries = (await fs.readFile(sums, "utf8")).trim().split(/\r?\n/);
    const entry = entries.map(line => line.trim().split(/\s+/)).find(parts => parts[1]?.replace(/^\*/, "") === path.basename(binary));
    const actual = crypto.createHash("sha256").update(await fs.readFile(binary)).digest("hex");
    if (!entry || !/^[a-f0-9]{64}$/i.test(entry[0]) || actual !== entry[0].toLowerCase()) throw new Error("Wrapper SHA256 verification failed");
  }
  await fs.chmod(binary, 0o755);
  const result = await deps.run(binary, ["--version"], { timeout: 10000 });
  if (!result.stdout.split(/\s+/).some((word, i, words) => word === tag && words[i - 1] === "version")) throw new Error(`Downloaded wrapper is not ${tag}`);
  return binary;
}

async function installWorker(options, overrides = {}) {
  const deps = { run, download, write: atomicWrite, log: console.log, ...overrides };
  const home = options.home || os.homedir();
  const installDir = path.resolve(options.installDir || path.join(home, ".claude"));
  const repoRoot = options.repoRoot;
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const version = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8")).version;
  const tag = `v${version}`;
  if (options.tag && options.tag !== tag) throw new Error(`Use npx github:${REPO}#${options.tag} for a different release; package and binary must match`);
  const binaryName = platform === "win32" ? "codeagent-wrapper.exe" : "codeagent-wrapper";
  const targetBinary = path.join(installDir, "bin", binaryName);
  assetName(platform, arch);
  const configDir = path.join(home, ".codeagent");
  const configPath = path.join(configDir, "config.json");
  for (const suffix of ["yaml", "yml", "toml"]) {
    if (await readOptional(path.join(configDir, `config.${suffix}`))) throw new Error(`Existing config.${suffix}: migrate it to config.json before updating; no files changed`);
  }
  const configBytes = await readOptional(configPath);
  const modelsPath = path.join(configDir, "models.json");
  const modelsBytes = await readOptional(modelsPath);
  const [config, models] = workerDefaults(parseObject(configBytes, "config.json"), parseObject(modelsBytes, "models.json"));
  const claudePath = path.join(installDir, "CLAUDE.md");
  const instructions = managedInstructions((await readOptional(claudePath) || "").toString(), targetBinary);
  const skill = await fs.readFile(path.join(repoRoot, "skills", "codeagent", "SKILL.md"));
  const plan = [
    [configPath, Buffer.from(JSON.stringify(config, null, 2) + "\n")],
    [modelsPath, Buffer.from(JSON.stringify(models, null, 2) + "\n")],
    [claudePath, Buffer.from(instructions)],
    [path.join(installDir, "skills", "codeagent", "SKILL.md"), skill],
    [path.join(home, ".agents", "skills", "codeagent", "SKILL.md"), skill],
  ];
  if (options.dryRun) { deps.log(`Would update ${tag}: ${[targetBinary, ...plan.map(item => item[0])].join(", ")}`); return; }
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), "myclaude-worker-"));
  try {
    const binary = await stageBinary({ repoRoot, stage, tag, platform, arch, buildFromSource: options.buildFromSource }, deps);
    plan.unshift([targetBinary, await fs.readFile(binary), 0o755]);
    const backup = path.join(configDir, "backups", `${Date.now()}-${crypto.randomUUID()}`);
    await fs.mkdir(backup, { recursive: true, mode: 0o700 });
    const originals = [];
    for (const [file] of plan) {
      const bytes = await readOptional(file);
      const mode = bytes === null ? 0o600 : (await fs.stat(file)).mode & 0o777;
      originals.push({ file, bytes, mode });
      if (bytes !== null) await fs.writeFile(path.join(backup, String(originals.length - 1)), bytes, { mode: 0o600 });
    }
    await fs.writeFile(path.join(backup, "manifest.json"), JSON.stringify(originals.map(({ file, bytes, mode }, index) => ({ file, backup: bytes === null ? null : String(index), mode })), null, 2), { mode: 0o600 });
    try {
      for (const [file, bytes, mode] of plan) await deps.write(file, bytes, mode);
    } catch (error) {
      for (const original of originals) {
        if (original.bytes === null) await fs.rm(original.file, { force: true });
        else await atomicWrite(original.file, original.bytes, original.mode);
      }
      throw error;
    }
    deps.log(`Installed ${tag}: ${targetBinary}\nDefault worker: Grok 4.6 (auto permissions, 3 workers).\nBackup: ${backup}\nEnsure ${path.dirname(targetBinary)} and the Grok CLI are in PATH. Run grok login on this machine before delegating work. Restart existing Claude/Codex sessions to reload skills.`);
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}

module.exports = { assetName, parseObject, workerDefaults, managedInstructions, atomicWrite, stageBinary, installWorker, download };
