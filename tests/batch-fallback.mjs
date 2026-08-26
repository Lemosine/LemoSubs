import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function loadExtension(file) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const encoded = Buffer.from(source).toString("base64");
  return (await import(`data:text/javascript;base64,${encoded}`)).default;
}

function response(body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    text: async () => text,
    json: async () => JSON.parse(text)
  };
}

function rssItem(title, hash) {
  return `
    <item>
      <title><![CDATA[${title}]]></title>
      <pubDate>Mon, 24 Aug 2026 00:00:00 GMT</pubDate>
      <nyaa:infoHash>${hash}</nyaa:infoHash>
      <nyaa:seeders>10</nyaa:seeders>
      <nyaa:leechers>1</nyaa:leechers>
      <nyaa:downloads>20</nyaa:downloads>
      <nyaa:size>1 GiB</nyaa:size>
    </item>`;
}

const compactTitle = "MAO S01E01-E13 1080p Multi-Subs";
const broadTitle = "Long Show S01E001-E170 1080p Multi-Subs";
const exactTitle = "MAO S01E01 1080p Multi-Subs";

const nyaa = await loadExtension("lemo.subs.nyaa.js");
const nyaaFeed = `<?xml version="1.0"?><rss xmlns:nyaa="https://nyaa.si/xmlns/nyaa"><channel>
  ${rssItem(compactTitle, "1111111111111111111111111111111111111111")}
  ${rssItem(broadTitle, "2222222222222222222222222222222222222222")}
  ${rssItem(exactTitle, "3333333333333333333333333333333333333333")}
  ${rssItem("MAO S01E02 1080p Multi-Subs", "4444444444444444444444444444444444444444")}
  ${rssItem("Maou 2099 S01E01 1080p Multi-Subs", "5555555555555555555555555555555555555555")}
</channel></rss>`;
const nyaaResults = await nyaa.single({
  titles: ["MAO"],
  episode: 1,
  fetch: async () => response(nyaaFeed)
});
assert.deepEqual(nyaaResults.map(item => item.hash).sort(), [
  "1111111111111111111111111111111111111111",
  "3333333333333333333333333333333333333333"
]);
assert.equal(nyaaResults.find(item => item.title === compactTitle)?.type, "batch");
assert.equal(nyaaResults.find(item => item.title === compactTitle)?.accuracy, "medium");

const noNyaaResults = await nyaa.single({
  titles: ["Long Show"],
  episode: 100,
  fetch: async () => response(nyaaFeed)
});
assert.equal(noNyaaResults.length, 0);

const seaDex = await loadExtension("lemo.subs.seadex.js");
const compactFiles = Array.from({ length: 13 }, (_, index) => ({
  name: `MAO S01E${String(index + 1).padStart(2, "0")}.mkv`,
  length: 100
}));
const broadFiles = Array.from({ length: 170 }, (_, index) => ({
  name: `Long Show E${String(index + 1).padStart(3, "0")}.mkv`,
  length: 100
}));
const seaDexData = {
  items: [{
    expand: {
      trs: [
        { infoHash: "compact", dualAudio: false, files: compactFiles, releaseGroup: "Test", created: 0 },
        { infoHash: "broad", dualAudio: false, files: broadFiles, releaseGroup: "Test", created: 0 },
        { infoHash: "exact", dualAudio: false, files: [{ name: exactTitle + ".mkv", length: 100 }], created: 0 }
      ]
    }
  }]
};
const seaDexResults = await seaDex.single({
  anilistId: 1,
  titles: ["MAO"],
  episode: 1,
  fetch: async () => response(seaDexData)
});
assert.deepEqual(seaDexResults.map(item => item.hash).sort(), ["compact", "exact"]);
assert.equal(seaDexResults.find(item => item.hash === "compact")?.type, "batch");

const neko = await loadExtension("lemo.subs.nekobt.js");
const nekoFetch = async url => {
  if (url.includes("limit=1")) {
    return response({ data: { media: { id: 5, episodes: [{ id: 7, tvdbId: 11, episode: 1 }] } } });
  }

  return response({
    data: {
      results: [
        { id: 1, title: compactTitle, batch: true, infohash: "compact", uploaded_at: 0 },
        { id: 2, title: broadTitle, batch: true, infohash: "broad", uploaded_at: 0 },
        { id: 3, title: exactTitle, batch: false, infohash: "exact", uploaded_at: 0 }
      ]
    }
  });
};
const nekoResults = await neko.single({
  tvdbId: 10,
  tvdbEId: 11,
  episode: 1,
  fetch: nekoFetch
});
assert.deepEqual(nekoResults.map(item => item.hash).sort(), ["compact", "exact"]);
assert.equal(nekoResults.find(item => item.hash === "compact")?.type, "batch");

const animeTosho = await loadExtension("lemo.subs.animetosho.js");
const animeToshoResults = await animeTosho.batch({
  anidbAid: 1,
  episode: 1,
  fetch: async () => response([
    { title: compactTitle, num_files: 13, info_hash: "compact", magnet_uri: "magnet:?compact" },
    { title: broadTitle, num_files: 170, info_hash: "broad", magnet_uri: "magnet:?broad" }
  ])
}, {});
assert.deepEqual(animeToshoResults.map(item => item.hash), ["compact"]);
assert.equal(animeToshoResults[0]?.type, "batch");

for (const extension of [nyaa, seaDex, neko, animeTosho]) {
  for (const method of ["test", "single", "batch", "movie"]) {
    assert.equal(typeof extension[method], "function");
  }
}

console.log("Batch fallback regression tests passed.");
