import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const configs = JSON.parse(await readFile(new URL("../index.json", import.meta.url), "utf8"));
const config = configs.find(item => item.name.endsWith(" SeaDex"));
const filename = new URL(config.code).pathname.split("/").at(-1);
const source = await readFile(new URL("../" + filename, import.meta.url), "utf8");
const extension = (await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"))).default;
const response = body => ({ ok: true, status: 200, text: async () =>
  typeof body === "string" ? body : JSON.stringify(body) });
const query = fetch => ({ anilistId: 1, titles: ["Example Show"], episode: 2, fetch });

test("SeaDex manifest permits its health and search URLs in Hayase desktop", async () => {
  // Mirrors storage.ts decoding and Electron app.ts URL-prefix matching, not a browser test.
  assert.equal(atob(config.url), "https://releases.moe/api/collections/entries/");
  assert.equal(new URL(config.code).searchParams.get("v"), config.version);
  const permitted = configs.filter(item => item.url).map(item => atob(item.url));
  const calls = [];
  const request = async url => {
    assert.ok(permitted.some(prefix => url.startsWith(prefix)));
    calls.push(new URL(url));
    return response({ items: [] });
  };
  assert.equal(await extension.test({ fetch: request }), true);
  assert.deepEqual(await extension.single(query(request)), []);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get("filter"), 'alID="1"');
  assert.equal(calls[1].searchParams.get("expand"), "trs");
  assert.equal("https://releases.moe.evil.invalid/api/collections/entries/".startsWith(atob(config.url)), false);
  assert.equal("https://releases.moe/api/admins".startsWith(atob(config.url)), false);
});

test("SeaDex distinguishes connection, HTTP, HTML and invalid JSON shape from valid empty results", async () => {
  for (const invoke of [
    fetch => extension.test({ fetch }),
    fetch => extension.single(query(fetch))
  ]) {
    for (const [request, pattern] of [
      [async () => { throw new TypeError("Failed to fetch"); }, /SeaDex connection failed.*releases\.moe/],
      [async () => ({ ok: true, text: async () => { throw new TypeError("Failed to fetch"); } }),
        /SeaDex connection failed.*releases\.moe/],
      [async () => ({ ok: false, status: 403 }), /HTTP 403/],
      [async () => ({ ok: false, status: 429 }), /HTTP 429/],
      [async () => ({ ok: false, status: 503 }), /HTTP 503/],
      [async () => response("<html>Unavailable</html>"), /instead of JSON/],
      [async () => response({ message: "Service unavailable" }), /invalid records response/],
      [async () => response(null), /invalid records response/],
      [async () => response({ items: {} }), /invalid records response/]
    ]) {
      let calls = 0;
      await assert.rejects(invoke(async (...args) => { calls++; return request(...args); }), pattern);
      assert.equal(calls, 1, "do not repeatedly retry a blocked or rate-limited provider");
    }
  }
  assert.equal(await extension.test({ fetch: async () => response({ items: [] }) }), true);
  assert.deepEqual(await extension.single(query(async () => response({ items: [] }))), []);
});

test("SeaDex accepts complete absolute-numbered long series with a known catalog count", async () => {
  const isDub = config.media === "dub";
  for (const [count, target] of [[52, 41], [170, 131], [170, 132]]) {
    const files = Array.from({ length: count }, (_, i) => ({
      name: "Example.Long.Show.S01E" + String(i + 1).padStart(2, "0") + ".1080p.mkv", length: 100
    }));
    const data = { items: [{ expand: { trs: [{
      infoHash: "a".repeat(40), dualAudio: isDub, files: files.toReversed()
    }] } }] };
    const results = await extension.single({
      anilistId: 1, titles: ["Example Long Show"], episode: target, episodeCount: count,
      fetch: async () => response(data)
    });
    assert.deepEqual(results.map(item => item.hash), ["a".repeat(40)]);
    assert.equal(results[0].type, "batch");
  }
});

test("SeaDex keeps uncertain, partial and restarted large packs out", async () => {
  const files = Array.from({ length: 170 }, (_, i) => ({
    name: "Example.Long.Show.S01E" + String(i + 1).padStart(2, "0") + ".1080p.mkv", length: 100
  }));
  const changed = (index, name) => files.map((file, i) => i === index ? { ...file, name } : file);
  for (const [label, candidates, count, episode = 131] of [
    ["unknown catalog count", files, undefined],
    ["wrong catalog count", files, 169],
    ["catalog count exceeds files", files, 171],
    ["invalid catalog count", files, "unknown"],
    ["missing requested episode", files.filter((_, i) => i !== 130), 170],
    ["missing another episode", files.filter((_, i) => i !== 10), 170],
    ["duplicate episode", [...files, files[0]], 170],
    ["restarted season", changed(12, "Example.Long.Show.S02E13.1080p.mkv"), 170],
    ["different series", changed(12, "Unrelated.Show.S01E13.1080p.mkv"), 170],
    ["unclear filename", [...files, { name: "Extras.mkv", length: 100 }], 170],
    ["multiple episode tokens", changed(12, "Example.Long.Show.S01E13.S01E14.mkv"), 170],
    ["episode range", changed(130, "Example.Long.Show.S01E131-E132.mkv"), 170],
    ["combined episodes", changed(130, "Example.Long.Show.S01E131+132.mkv"), 170],
    ["fractional episode", changed(130, "Example.Long.Show.S01E131.5.mkv"), 170],
    ["unverified plain numbering", files.map((file, i) => ({
      ...file, name: "Example Long Show - " + String(i + 1).padStart(3, "0") + ".mkv"
    })), 170],
    ["out-of-range request", files, 170, 171]
  ]) {
    const data = { items: [{ expand: { trs: [{
      infoHash: "a".repeat(40), dualAudio: config.media === "dub", files: candidates
    }] } }] };
    const results = await extension.single({
      anilistId: 1, titles: ["Example Long Show"], episode, episodeCount: count,
      fetch: async () => response(data)
    });
    assert.deepEqual(results, [], label);
  }
});

test("SeaDex verified long packs preserve language separation and reject ambiguous matches", async () => {
  const files = Array.from({ length: 170 }, (_, i) => ({
    name: "Example.Long.Show.S01E" + String(i + 1).padStart(2, "0") + ".1080p.mkv", length: 100
  }));
  const torrent = (hash, dualAudio, extraEpisode, separator = "") => ({
    infoHash: hash.repeat(40), dualAudio,
    files: [...files, { name: "Example.Long.Show.S00" + separator + "E" + extraEpisode + ".1080p.mkv", length: 100 }]
  });
  const data = { items: [{ expand: { trs: [
    torrent("a", config.media === "dub", "02"),
    torrent("b", config.media !== "dub", "02"),
    torrent("c", config.media === "dub", "131"),
    torrent("d", config.media === "dub", "02", ".")
  ] } }] };
  const results = await extension.single({
    anilistId: 1, media: { title: { english: "Example Long Show" }, episodes: 170 }, episode: 131,
    fetch: async () => response(data)
  });
  assert.deepEqual(results.map(item => item.hash), ["a".repeat(40), "d".repeat(40)],
    "use the catalog count, preserve audio separation, and require one unique target");
});

test("SeaDex transport fixes preserve episode and dub/sub filtering", async () => {
  const isDub = config.media === "dub";
  const torrent = (hash, episode, dualAudio) => ({
    infoHash: hash.repeat(40), dualAudio, created: "2026-10-01T00:00:00Z",
    files: [{ name: "Example Show S01E" + episode + ".mkv", length: 100 }]
  });
  const data = { items: [{ expand: { trs: [
    torrent("a", "02", isDub),
    torrent("b", "01", isDub),
    torrent("c", "02", !isDub)
  ] } }] };
  const results = await extension.single(query(async () => response(data)));
  assert.deepEqual(results.map(item => item.hash), ["a".repeat(40)]);
  for (const method of ["test", "single", "batch", "movie"]) assert.equal(typeof extension[method], "function");
});
