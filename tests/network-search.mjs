import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const configs = JSON.parse(await readFile(new URL("../index.json", import.meta.url), "utf8"));
const isDub = configs[0].media === "dub";
const extensions = {};
for (const config of configs) {
  const filename = new URL(config.code).pathname.split("/").at(-1);
  const source = await readFile(new URL("../" + filename, import.meta.url), "utf8");
  extensions[config.name.split(" ")[2]] =
    (await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"))).default;
}

const response = body => ({ ok: true, status: 200, text: async () =>
  typeof body === "string" ? body : JSON.stringify(body) });
const never = () => new Promise(() => {});
const audio = isDub ? "[English Dub]" : "[MultiSub]";
const item = (title, hash) => "<item><title><![CDATA[" + title + "]]></title>" +
  "<nyaa:infoHash>" + hash.repeat(40) + "</nyaa:infoHash></item>";
const english = "BLEACH: Thousand-Year Blood War - The Calamity";
const feed = "<rss><channel>" +
  item("BLEACH.Thousand.Year.Blood.War.S04E01.GOD.OF.THUNDER.1080p " + audio + " | The Calamity", "a") +
  item("BLEACH.Thousand.Year.Blood.War.S04E02.SON.OF.DARKNESS.1080p " + audio + " | The Calamity", "b") +
  item("Unrelated Show S04E01 1080p " + audio, "c") +
  item("BLEACH.Thousand.Year.Blood.War.S04E01.1080p " +
    (isDub ? "[MultiSub]" : "[English Dub]") + " | The Calamity", "d") +
  "</channel></rss>";
const calls = [];
const query = {
  media: {
    title: { romaji: "BLEACH: Sennen Kessen-hen - Kashin-tan", english, native: "Native title" }
  },
  titles: [],
  episode: 1,
  fetch: async url => {
    const text = new URL(url).searchParams.get("q");
    calls.push(text);
    // Hold the request so concurrent single/batch calls can share it.
    await new Promise(resolve => setTimeout(resolve, 5));
    return response(text.startsWith("bleach thousand year blood war the calamity")
      ? feed : "<rss><channel></channel></rss>");
  }
};
const nyaa = extensions.Nyaa;
const [single, batch] = await Promise.all([nyaa.single(query), nyaa.batch(query)]);
assert.deepEqual(single.map(result => result.hash), ["a".repeat(40)]);
assert.deepEqual(batch.map(result => result.hash), ["a".repeat(40)]);
assert.equal(calls.length, new Set(calls).size, "single/batch must share pending requests");
assert.ok(calls.length <= 9, "three title aliases should need at most nine Nyaa requests");
assert.ok(calls.includes("bleach thousand year blood war the calamity 01"));

// Metadata from split seasons must still search the shorter release title.
const seasonQueries = [];
await nyaa.single({
  titles: ["Example Show Season 4"], episode: 3,
  fetch: async url => {
    seasonQueries.push(new URL(url).searchParams.get("q"));
    return response("<rss><channel></channel></rss>");
  }
});
assert.ok(seasonQueries.includes("example show 03"));

// RSS searches for "08" can miss the single token "S01E08"; a broad feed can be full of newer releases.
for (const scenario of [
  { title: "LIAR GAME", base: "LIAR GAME", episode: 8, season: 1 },
  { title: "Example Show Season 4", base: "Example Show", episode: 8, season: 4 },
  { title: "Long Running Show", base: "Long Running Show", episode: 132, season: 1 }
]) {
  const marker = "S" + String(scenario.season).padStart(2, "0") +
    "E" + String(scenario.episode).padStart(2, "0");
  const exactQuery = scenario.base.toLowerCase() + " " + marker;
  const targetTitle = scenario.base + " " + marker + " 1080p " + audio;
  const latestFeed = "<rss><channel>" +
    Array.from({ length: 100 }, () => item(scenario.base + " S01E200 1080p " + audio, "b")).join("") +
    "</channel></rss>";
  const found = await nyaa.single({
    titles: [scenario.title], episode: scenario.episode,
    fetch: async url => {
      const q = new URL(url).searchParams.get("q");
      return response(q === exactQuery
        ? "<rss><channel>" + item(targetTitle, "a") +
          item(scenario.base + " S01E200 1080p " + audio, "b") + "</channel></rss>"
        : latestFeed);
    }
  });
  assert.deepEqual(found.map(result => result.title), [targetTitle],
    "find explicit episode tokens even when broad RSS results omit the requested episode");
}

await assert.rejects(nyaa.single({ titles: ["Example"], episode: 1,
  fetch: async () => ({ ok: false, status: 429 }) }), /HTTP 429/);
await assert.rejects(nyaa.single({ titles: ["Example"], episode: 1,
  fetch: async () => response("<html>Unavailable</html>") }), /instead of an RSS feed/);
assert.deepEqual(await nyaa.single({ titles: ["Example"], episode: 1,
  fetch: async () => response("<rss><channel></channel></rss>") }), []);
const partial = await nyaa.single({ ...query, fetch: async url => {
  if (new URL(url).searchParams.get("q").startsWith("bleach thousand")) return response(feed);
  throw new Error("Temporary failure");
}});
assert.deepEqual(partial.map(result => result.hash), ["a".repeat(40)]);

const tosho = Object.entries(extensions).find(([name]) => name.startsWith("AnimeTosho"))?.[1];
assert.ok(tosho);
let probe;
assert.equal(await tosho.test({ fetch: async url => {
  probe = new URL(url);
  return response([]);
}}), true);
assert.equal(probe.searchParams.get("aid"), "1");
await assert.rejects(tosho.single({ anidbEid: 1,
  fetch: async () => response("<html>Unavailable</html>") }), /instead of JSON/);
await assert.rejects(tosho.test({ fetch: async () =>
  ({ ok: false, status: 503 }) }), /HTTP 503/);

const neko = extensions.NekoBT;
assert.deepEqual(await neko.single({ episode: 1,
  fetch: async () => { throw new Error("No request should be made without a show id"); } }), []);
let episodeID;
await neko.single({ tvdbId: 10, episode: 2, fetch: async url => {
  const params = new URL(url).searchParams;
  if (params.has("limit")) return response({ data: { media: { id: 5,
    episodes: [{ id: 101, episode: 1 }, { id: 102, episode: 2 }] } } });
  episodeID = params.get("episode_ids");
  return response({ data: { results: [] } });
}});
assert.equal(episodeID, "102", "missing TVDB episode ids must not select episode 1");

// Real timers test both a stuck fetch and a stuck body, including transports that ignore abort.
const started = Date.now();
await Promise.all(Object.values(extensions).flatMap(extension =>
  [false, true].map(async stalledBody => {
    let signal;
    await assert.rejects(extension.test({ fetch: async (_url, options) => {
      signal = options.signal;
      return stalledBody ? { ok: true, status: 200, text: never } : never();
    }}), /respond.*(?:6 seconds|time)/);
    assert.equal(signal.aborted, true);
  })
));
assert.ok(Date.now() - started < 9000, "requests must finish before Hayase's 20-second timeout");
console.log("Network timeout, archive health, alternate title and request-sharing tests passed.");
