import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";

const configs = JSON.parse(await readFile(new URL("../index.json", import.meta.url), "utf8"));
const config = configs.find(item => item.name.endsWith(" Knaben"));
const filename = new URL(config.code).pathname.split("/").at(-1);
const source = await readFile(new URL("../" + filename, import.meta.url), "utf8");
const extension = (await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"))).default;
const dub = config.media === "dub";
const audio = dub ? "[English Dub]" : "[Multi-Subs]";
const response = data => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });
const row = (title = "Example Show S04E08 1080p " + audio, hash = "a".repeat(40), extra = {}) => ({
  title, hash, categoryId: [6000000, 6001000], trackerId: "nyaasi", bytes: 123456,
  seeders: 20, liveSeeders: 0, peers: 3, livePeers: 1, date: "2026-10-01T00:00:00Z", ...extra
});
const query = fetch => ({ titles: ["Example Show Season 4"], episode: 8, resolution: "1080p", fetch });

function timer(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.UTC(2026, 0, 1) });
  return async ms => { t.mock.timers.tick(ms); await setImmediate(); };
}

async function settle(promise, advance) {
  let done;
  promise.then(value => { done = { value }; }, error => { done = { error }; });
  await setImmediate();
  for (let ms = 0; !done && ms < 15000; ms += 100) await advance(100);
  assert.ok(done, "search must settle before Hayase's deadline");
  if (done.error) throw done.error;
  return done.value;
}

test("valid manifest, standalone exports and fail-closed title/episode/audio/category filtering", async t => {
  const advance = timer(t);
  assert.equal(config.type, "torrent");
  for (const method of ["test", "single", "batch", "movie"]) assert.equal(typeof extension[method], "function");
  const good = row();
  const hits = [
    null, {}, good, { ...good, hash: good.hash.toUpperCase() },
    row("Unrelated Show S04E08 1080p " + audio, "b".repeat(40)),
    row("Example Show S03E08 1080p " + audio, "c".repeat(40)),
    row("Example Show S04E09 1080p " + audio, "d".repeat(40)),
    row("Example Show S04E08 720p " + audio, "e".repeat(40)),
    row("Example Show S04E08 1080p " + (dub ? "[MultiSub]" : "[English Dub]"), "f".repeat(40)),
    row("Example Show S04E08 1080p [Dual Audio]", "1".repeat(40)),
    row("Example Show S04E08 1080p [Multi-Audio]", "2".repeat(40)),
    row("Example Show S04E08 1080p " + audio, "3".repeat(40), { categoryId: [6000000,6008000] }),
    row("Example Show S04E08 1080p " + audio, "4".repeat(40), { categoryId: [6000000,6004000] }),
    row("Example Show S04E08 1080p " + audio, "5".repeat(40), { categoryId: [4000000] }),
    row("Example Show S04E08 1080p " + audio + ".exe", "6".repeat(40)),
    row("Example Show S04E08 1080p " + audio, "bad-hash", { magnetUrl: "https://example.invalid/file.torrent" })
  ];
  const calls = [];
  const fetch = async url => {
    const parsed = new URL(url);
    calls.push(parsed.searchParams.get("q"));
    assert.equal(parsed.origin, "https://api.knaben.org");
    assert.equal(parsed.pathname, "/v2/search");
    assert.equal(parsed.searchParams.get("c"), "6000000");
    assert.equal(parsed.searchParams.has("unsafe"), false);
    assert.equal(parsed.searchParams.has("xxx"), false);
    return response({ hits });
  };
  const results = await settle(extension.single(query(fetch)), advance);
  assert.equal(calls.length, 1);
  assert.deepEqual(results.map(item => item.hash), [good.hash]);
  assert.equal(results[0].seeders, 0, "a live zero must not fall back to stale seed counts");
  assert.equal(results[0].leechers, 1);
  assert.equal(results[0].size, 123456);
  assert.match(results[0].link, /^magnet:\?xt=urn:btih:/);
  assert.equal(results[0].accuracy, "low");
  assert.deepEqual(await settle(extension.single({ ...query(fetch), exclusions: ["Example"] }), advance), []);
});

test("Base32 hashes, magnet-only entries and cross-index duplicates normalize to Hayase hashes", async t => {
  const advance = timer(t);
  const title = "Example Show S04E08 1080p [English " + (dub ? "Dub" : "Sub") + "]";
  const rows = [
    row(title, "A".repeat(32), { trackerId: "tokyotosho", categoryId: [6000000] }),
    row(title, "0".repeat(40)),
    row(title, null, { magnetUrl: "magnet:?xt=urn:btih:" + "7".repeat(32) }),
    row(title, "X".repeat(31)),
    row(title, null, { magnetUrl: "file:///C:/private" })
  ];
  const result = await settle(extension.single(query(async () => response({ hits: rows }))), advance);
  assert.deepEqual(result.map(item => item.hash), ["0".repeat(40), "f".repeat(40)]);
  assert.ok(result.every(item => !item.link.includes("file:")));
});

test("preserve aliases, explicit/plain tokens, short titles and bounded batch fallbacks", async t => {
  const advance = timer(t);
  for (const method of ["single", "batch"]) {
    const calls = [];
    const result = await settle(extension[method]({
      media: { title: { romaji: "Different Name", english: "MAO" } }, titles: [], episode: 8,
      fetch: async url => {
        const q = new URL(url).searchParams.get("q");
        calls.push(q);
        return response({ hits: q.startsWith("mao") ? [
          row("MAO - 08 1080p " + audio),
          row("MAO S01E01-E13 1080p " + audio, "b".repeat(40)),
          row("MAO S01E001-E170 1080p " + audio, "c".repeat(40)),
          row("Maou 2099 - 08 1080p " + audio, "d".repeat(40)),
          row("MAO S01E09 1080p " + audio, "e".repeat(40))
        ] : [] });
      }
    }), advance);
    assert.equal(result.length, 2);
    assert.equal(result[1].type, "batch");
    assert.ok(calls.some(q => q.startsWith("mao")));
  }
  const queries = [];
  const found = await settle(extension.single({
    titles: ["Example Show Season 4"], episode: 8, fetch: async url => {
      const q = new URL(url).searchParams.get("q");
      queries.push(q);
      return response({ hits: q === "example show 08" ? [row()] : [] });
    }
  }), advance);
  assert.equal(found.length, 1);
  assert.deepEqual(queries, ["example show S04E08", "example show 08"]);
});

test("movie results and missing-title guards", async t => {
  const advance = timer(t);
  let calls = 0;
  const fetch = async () => { calls++; return response({ hits: [row("Example Film 1080p " + audio)] }); };
  assert.equal((await settle(extension.movie({ titles: ["Example Film"], fetch }), advance)).length, 1);
  assert.deepEqual(await extension.single({ episode: 1, fetch }), []);
  assert.equal(calls, 1);
});

test("pending/cache sharing re-filters each episode and respects 429 Retry-After", async t => {
  const advance = timer(t);
  let calls = 0;
  const starts = [];
  const fetch = async () => {
    starts.push(Date.now());
    calls++;
    if (calls === 3) return { ok: false, status: 429, headers: new Headers({ "Retry-After": "60" }) };
    return response({ hits: [row(), row("Example Show S04E09 1080p " + audio, "b".repeat(40))] });
  };
  const first = await settle(Promise.all([extension.single(query(fetch)), extension.single(query(fetch)), extension.batch(query(fetch))]), advance);
  assert.ok(first.every(items => items.length === 1));
  assert.equal(calls, 2);
  assert.ok(starts[1] - starts[0] >= 1000);
  const next = await settle(extension.batch({ ...query(fetch), episode: 9 }), advance);
  assert.deepEqual(next.map(item => item.hash), ["b".repeat(40)]);
  await settle(assert.rejects(extension.test({ fetch }), /HTTP 429/), advance);
  await assert.rejects(extension.single({ ...query(fetch), episode: 10 }), /Wait/);
  assert.equal(calls, 3);
  assert.equal((await extension.single(query(fetch))).length, 1);
  await advance(60000);
  await settle(extension.single(query(fetch)), advance);
  assert.equal(calls, 4, "cached success expires; requests resume after cooldown");
});

test("JSON/schema/HTTP failures stay separate from an empty successful response", async t => {
  const advance = timer(t);
  for (const [fetch, message] of [
    [async () => ({ ok: true, text: async () => "<html>unavailable</html>" }), /instead of JSON/],
    [async () => response({ error: "unexpected response" }), /invalid search response/],
    [async () => ({ ok: false, status: 503 }), /HTTP 503/]
  ]) await settle(assert.rejects(extension.test({ fetch }), message), advance);
  assert.equal(await extension.test({ fetch: async () => response({ hits: [] }) }), true);
});

test("stalled bodies abort and queued searches expire without later requests", async t => {
  const advance = timer(t);
  const signals = [];
  const fetch = async (_url, options) => {
    signals.push(options.signal);
    return { ok: true, status: 200, text: () => new Promise(() => {}) };
  };
  const started = Date.now();
  const results = await settle(Promise.allSettled(Array.from({ length: 5 }, (_, i) =>
    extension.single({ titles: ["Example" + i], episode: 1, fetch })
  )), advance);
  assert.ok(Date.now() - started <= 14000);
  assert.ok(results.every(result => result.status === "rejected"));
  assert.equal(signals.length, 3);
  assert.ok(signals.every(signal => signal.aborted));
  await advance(60000);
  assert.equal(signals.length, 3);
});
