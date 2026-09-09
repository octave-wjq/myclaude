"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const worker = require("../bin/worker-install");
const repoRoot = path.resolve(__dirname, "..");
const tag = `v${require("../package.json").version}`;
const payload = Buffer.from("verified wrapper fixture");
const checksum = crypto.createHash("sha256").update(payload).digest("hex");

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "worker-test-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const calls = [];
  const options = { home, repoRoot, platform: "linux", arch: "x64" };
  const deps = {
    log: message => calls.push(message),
    download: async (url, dest) => {
      calls.push(url);
      await fs.writeFile(dest, url.endsWith("SHA256SUMS") ? `${checksum}  codeagent-wrapper-linux-amd64\n` : payload);
    },
    run: async (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === "go") await fs.writeFile(args[args.indexOf("-o") + 1], payload);
      return { stdout: `codeagent-wrapper version ${tag}\n` };
    },
  };
  const file = relative => path.join(home, relative);
  const put = async (relative, data) => worker.atomicWrite(file(relative), data);
  const get = relative => fs.readFile(file(relative), "utf8");
  return { home, options, deps, calls, file, put, get };
}

test("supported assets and invalid platforms", () => {
  for (const platform of ["linux", "darwin", "win32"]) {
    for (const arch of ["x64", "arm64"]) assert.match(worker.assetName(platform, arch), /^codeagent-wrapper-/);
  }
  assert.equal(worker.assetName("win32", "x64"), "codeagent-wrapper-windows-amd64.exe");
  assert.throws(() => worker.assetName("linux", "ia32"), /Unsupported/);
  assert.throws(() => worker.assetName("freebsd", "x64"), /Unsupported/);
});

test("JSON validation and bounded defaults preserve custom data", () => {
  assert.deepEqual(worker.parseObject(null, "config"), {});
  for (const raw of ["null", "[]", "42", "false", "oops"]) assert.throws(() => worker.parseObject(Buffer.from(raw), "config"));
  assert.throws(() => worker.workerDefaults({}, { agents: [] }), /models.agents/);
  const config = { backend: "codex", model: "gpt-5", custom: 42 };
  const models = { backends: { grok: { api_key: "dummy-secret" } }, agents: { work: { prompt: "keep", reasoning: "low", yolo: true }, develop: { tools: ["read"] }, bespoke: { backend: "claude", reasoning: "medium" } } };
  const [next, updated] = worker.workerDefaults(config, models);
  assert.deepEqual(next, { backend: "grok", custom: 42 });
  assert.equal(config.model, "gpt-5");
  assert.equal(updated.agents.work.yolo, false);
  assert.equal(updated.agents.work.reasoning, "xhigh");
  assert.equal(updated.agents.develop.reasoning, "xhigh");
  assert.equal(updated.agents.work.prompt, "keep");
  assert.deepEqual(updated.agents.develop.tools, ["read"]);
  assert.deepEqual(updated.agents.bespoke, models.agents.bespoke);
  assert.deepEqual(updated.backends, models.backends);
});

test("instruction block is idempotent and preserves surrounding content", () => {
  const first = worker.managedInstructions("Custom instructions\n", "/path with spaces/wrapper");
  assert.match(first, /Custom instructions/);
  assert.match(first, /Grok 4.6, xhigh effort/);
  assert.equal(worker.managedInstructions(first, "/path with spaces/wrapper"), first);
  assert.ok(worker.managedInstructions(first + "after", "/new/wrapper").endsWith("after"));
  for (const broken of ["<!-- myclaude-worker:start -->", "<!-- myclaude-worker:end -->", "<!-- myclaude-worker:end --><!-- myclaude-worker:start -->"]) assert.throws(() => worker.managedInstructions(broken, "x"), /Malformed/);
});

test("fresh installation validates, writes all targets and records backup manifest", async t => {
  const f = await fixture(t);
  await worker.installWorker(f.options, f.deps);
  assert.equal(await f.get(".claude/bin/codeagent-wrapper"), payload.toString());
  assert.equal(JSON.parse(await f.get(".codeagent/config.json")).backend, "grok");
  assert.equal(JSON.parse(await f.get(".codeagent/models.json")).agents.work.model, "grok-4.6");
  assert.equal(JSON.parse(await f.get(".codeagent/models.json")).agents.work.reasoning, "xhigh");
  assert.equal(await f.get(".claude/skills/codeagent/SKILL.md"), await f.get(".agents/skills/codeagent/SKILL.md"));
  const backups = await fs.readdir(f.file(".codeagent/backups"));
  const manifest = JSON.parse(await f.get(`.codeagent/backups/${backups[0]}/manifest.json`));
  assert.equal(manifest.length, 6);
  assert.ok(manifest.every(entry => entry.backup === null));
  assert.equal((await fs.stat(f.file(".claude/bin/codeagent-wrapper"))).mode & 0o777, 0o755);
  assert.ok(f.calls.some(c => typeof c === "string" && c.includes(`/download/${tag}/`)));
});

test("existing installation is overwritten while credentials and user files survive", async t => {
  const f = await fixture(t);
  const originals = {
    ".claude/bin/codeagent-wrapper": "old executable",
    ".claude/skills/codeagent/SKILL.md": "old skill",
    ".claude/CLAUDE.md": "My custom instructions\n",
    ".claude/settings.json": '{"env":{"ANTHROPIC_AUTH_TOKEN":"dummy-secret"}}',
    ".codeagent/config.json": '{"backend":"codex","model":"gpt-5","custom":true}',
    ".codeagent/models.json": '{"backends":{"grok":{"api_key":"dummy-secret"}},"agents":{"custom":{"backend":"claude"},"explore":{"backend":"codex"}}}',
  };
  for (const [p, bytes] of Object.entries(originals)) await f.put(p, bytes);
  await worker.installWorker(f.options, f.deps);
  assert.equal(await f.get(".claude/settings.json"), originals[".claude/settings.json"]);
  const models = JSON.parse(await f.get(".codeagent/models.json"));
  assert.equal(models.backends.grok.api_key, "dummy-secret");
  assert.equal(models.agents.custom.backend, "claude");
  assert.equal(models.agents.explore.backend, "grok");
  assert.equal(JSON.parse(await f.get(".codeagent/config.json")).custom, true);
  const instructions = await f.get(".claude/CLAUDE.md");
  assert.ok(instructions.startsWith("My custom instructions"));
  const [backup] = await fs.readdir(f.file(".codeagent/backups"));
  const manifest = JSON.parse(await f.get(`.codeagent/backups/${backup}/manifest.json`));
  for (const entry of manifest.filter(e => e.backup !== null)) {
    assert.equal(await fs.readFile(f.file(`.codeagent/backups/${backup}/${entry.backup}`), "utf8"), originals[path.relative(f.home, entry.file)]);
  }
  await worker.installWorker(f.options, f.deps);
  assert.equal(await f.get(".claude/CLAUDE.md"), instructions);
});

test("invalid configuration fails before download or replacement", async t => {
  for (const [name, data] of [["config.json", "bad"], ["models.json", "[]"], ["config.yaml", "backend: codex"], ["config.yml", "backend: codex"], ["config.toml", 'backend="codex"']]) {
    const f = await fixture(t);
    await f.put(`.codeagent/${name}`, data);
    await f.put(".claude/bin/codeagent-wrapper", "old");
    await assert.rejects(worker.installWorker(f.options, f.deps));
    assert.equal(await f.get(".claude/bin/codeagent-wrapper"), "old");
    assert.deepEqual(f.calls, []);
  }
});

test("dry run does not create installation or download", async t => {
  const f = await fixture(t);
  await worker.installWorker({ ...f.options, dryRun: true }, f.deps);
  assert.deepEqual(await fs.readdir(f.home), []);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0], /Would update/);
  await assert.rejects(worker.installWorker({ ...f.options, tag: "v0.0.0" }, f.deps), /package and binary/);
});

test("download, checksum and exact version failures leave old binary untouched", async t => {
  for (const failure of ["download", "checksum", "missing", "version"]) {
    const f = await fixture(t);
    await f.put(".claude/bin/codeagent-wrapper", "old");
    const deps = { ...f.deps };
    if (failure === "download") deps.download = async () => { throw new Error("network unavailable"); };
    if (failure === "checksum") deps.download = async (_, dest) => fs.writeFile(dest, "bad checksum");
    if (failure === "missing") deps.download = async (_, dest) => fs.writeFile(dest, `${checksum}  wrong-asset`);
    if (failure === "version") deps.run = async () => ({ stdout: `codeagent-wrapper version ${tag}-stale` });
    await assert.rejects(worker.installWorker(f.options, deps));
    assert.equal(await f.get(".claude/bin/codeagent-wrapper"), "old");
    assert.deepEqual(await fs.readdir(f.home), [".claude"]);
  }
});

test("write failure rolls back old files and removes newly created targets", async t => {
  const f = await fixture(t);
  await f.put(".claude/bin/codeagent-wrapper", "old");
  await fs.chmod(f.file(".claude/bin/codeagent-wrapper"), 0o700);
  let writes = 0;
  await assert.rejects(worker.installWorker(f.options, { ...f.deps, write: async (...args) => {
    if (++writes === 4) throw new Error("simulated disk failure");
    await worker.atomicWrite(...args);
  } }), /simulated disk/);
  assert.equal(await f.get(".claude/bin/codeagent-wrapper"), "old");
  assert.equal((await fs.stat(f.file(".claude/bin/codeagent-wrapper"))).mode & 0o777, 0o700);
  await assert.rejects(f.get(".codeagent/config.json"), { code: "ENOENT" });
});

test("source build injects package version and supports custom install directory", async t => {
  const f = await fixture(t);
  const installDir = f.file("custom claude");
  await worker.installWorker({ ...f.options, installDir, buildFromSource: true }, f.deps);
  assert.equal(await f.get("custom claude/bin/codeagent-wrapper"), payload.toString());
  const command = f.calls.find(c => Array.isArray(c) && c[0] === "go");
  assert.ok(command[1].includes(`-s -w -X codeagent-wrapper/internal/app.version=${tag}`));
  assert.ok(!f.calls.some(c => typeof c === "string" && c.startsWith("https://")));
});

test("unreadable configuration propagates filesystem errors", async t => {
  const f = await fixture(t);
  await fs.mkdir(f.file(".codeagent/config.json"), { recursive: true });
  await assert.rejects(worker.installWorker(f.options, f.deps));
});

test("CLI defaults and --update route to noninteractive worker installer", async t => {
  const f = await fixture(t);
  for (const args of [["--dry-run"], ["--update", "--dry-run"], ["--build-from-source", "--dry-run"]]) {
    const stdout = execFileSync(process.execPath, [path.join(repoRoot, "bin/cli.js"), ...args], { env: { ...process.env, HOME: f.home, USERPROFILE: f.home }, encoding: "utf8" });
    assert.match(stdout, /Would update v/);
    assert.ok(stdout.includes(f.home));
  }
  assert.match(execFileSync(process.execPath, [path.join(repoRoot, "bin/cli.js"), "--help"], { encoding: "utf8" }), /--legacy/);
  assert.deepEqual(await fs.readdir(f.home), []);
});
