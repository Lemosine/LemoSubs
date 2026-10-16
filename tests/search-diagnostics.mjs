import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";

const configs = JSON.parse(await readFile(new URL("../index.json", import.meta.url), "utf8"));

function clock(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.UTC(2026, 0, 1) });
  return async ms => { t.mock.timers.tick(ms); await setImmediate(); };
}

async function settle(promise, advance) {
  let result;
  promise.then(value => { result = { value }; }, error => { result = { error }; });
  await setImmediate();
  for (let ms = 0; !result && ms < 15000; ms += 100) await advance(100);
  assert.ok(result, "search must settle within its deadline");
  if (result.error) throw result.error;
  return result.value;
}

for (const provider of ["Nyaa", "Knaben"]) {
  const config = configs.find(item => item.name.endsWith(" " + provider));
  const filename = new URL(config.code).pathname.split("/").at(-1);
  const source = await readFile(new URL("../" + filename, import.meta.url), "utf8");
  const extension = (await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"))).default;
  const audio = config.media === "dub" ? "[English Dub]" : "[MultiSub]";
  const otherAudio = config.media === "dub" ? "[MultiSub]" : "[English Dub]";
  const goodTitle = "Target Example S02E08 1080p " + audio;
  const query = {
    media: { title: {
      romaji: "First.Canonical: Name Season 2",
      english: "Second.Canonical: Name Season 2",
      native: "Target Example"
    }},
    titles: ["Fourth Alias"],
    episode: 8,
    resolution: "1080p"
  };
  function response(titles = []) {
    const hits = titles.map((title, i) => ({
      title, hash: (i + 1).toString(16).repeat(40), categoryId: [6000000, 6001000],
      trackerId: "nyaasi", bytes: 123456, seeders: 1, date: "2026-01-01T00:00:00Z"
    }));
    const body = provider === "Knaben" ? JSON.stringify({ hits }) :
      "<rss><channel>" + hits.map(row =>
        "<item><title><![CDATA[" + row.title + "]]></title><nyaa:infoHash>" +
        row.hash + "</nyaa:infoHash></item>").join("") + "</channel></rss>";
    return { ok: true, status: 200, text: async () => body };
  }

  test(provider + ": searched aliases survive local filtering without more requests", async t => {
    const advance = clock(t);
    for (const method of ["single", "batch", "movie"]) {
      const calls = [];
      const result = await settle(extension[method]({ ...query, fetch: async url => {
        const term = new URL(url).searchParams.get("q");
        calls.push(term);
        return response(term.startsWith("target example") ? [
          goodTitle,
          "Target Example S01E08 1080p " + audio,
          "Target Example S02E09 1080p " + audio,
          "Target Example S02E08 1080p " + otherAudio,
          "Unrelated Series S02E08 1080p " + audio
        ] : []);
      }}), advance);
      assert.ok(calls.some(term => term.startsWith("target example")), "third alias must be searched");
      assert.ok(calls.length <= (method === "batch" ? 3 : 9), "keep the current query budget");
      assert.ok(calls.every(term => !term.startsWith("fourth alias")), "do not add network aliases");
      assert.deepEqual(result.map(item => item.hash), ["1".repeat(40)],
        "accept the searched alias while rejecting wrong episode, season, title and audio");
    }
  });

  test(provider + ": partial failures must not be reported as a completed empty search", async t => {
    const advance = clock(t);
    for (const method of ["single", "batch", "movie"]) {
      for (const failedAlias of ["first canonical name", "target example"]) {
        let calls = 0;
        const result = await settle(extension[method]({ ...query, fetch: async url => {
          calls++;
          const term = new URL(url).searchParams.get("q");
          return term.startsWith(failedAlias) ? { ok: false, status: 503 } : response();
        }}).then(value => ({ value }), error => ({ error })), advance);
        assert.match(result.error?.message ?? "search returned no error", /HTTP 503/,
          "an empty successful alias must not hide an earlier or later failed alias");
        assert.equal(calls, method === "batch" ? 3 : 9);
      }
    }
  });

  test(provider + ": bracketed dub labels follow translated Nyaa provenance and stay out of subs", async t => {
    const advance = clock(t);
    const rows = [
      { title: "Target Example S02E08 1080p [Dub]", hash: "a".repeat(40) },
      { title: "Target Example S02E08 1080p [ dUb ]", hash: "b".repeat(40) },
      { title: "Target Example S02E08 1080p [MultiSub]", hash: "c".repeat(40) },
      { title: "Target Example S02E09 1080p [Dub]", hash: "d".repeat(40) },
      { title: "Target Example S01E08 1080p [Dub]", hash: "e".repeat(40) },
      { title: "Unrelated Series S02E08 1080p [Dub]", hash: "f".repeat(40) },
      { title: "Target Example S02E08 1080p [German Dub]", hash: "1".repeat(40) },
      { title: "Target Example S02E08 1080p [Dub]", hash: "2".repeat(40), category: "1_3" },
      { title: "Target Example S02E08 1080p [Dub]", hash: "3".repeat(40), category: "1_4" },
      { title: "Target Example S02E08 1080p Dub", hash: "4".repeat(40) }
    ];
    if (provider === "Knaben") {
      rows.push(
        { title: "Target Example S02E08 1080p [Dub]", hash: "5".repeat(40), tracker: "tokyotosho" },
        { title: "Target Example S02E08 1080p [Dub]", hash: "6".repeat(40), category: "unknown" }
      );
    }
    for (const method of ["single", "batch", "movie"]) {
      let calls = 0;
      const result = await settle(extension[method]({
        titles: ["Target Example Season 2"], episode: 8, fetch: async url => {
          calls++;
          if (provider === "Nyaa") assert.equal(new URL(url).searchParams.get("c"), "1_2");
          const body = provider === "Knaben" ? JSON.stringify({ hits: rows.map(row => ({
            title: row.title, hash: row.hash, trackerId: row.tracker ?? "nyaasi",
            categoryId: row.category ? [6000000] : [6000000, 6001000]
          })) }) : "<rss><channel>" + rows.map(row =>
            "<item><title><![CDATA[" + row.title + "]]></title><nyaa:infoHash>" +
            row.hash + "</nyaa:infoHash><nyaa:categoryId>" + (row.category ?? "1_2") +
            "</nyaa:categoryId></item>").join("") + "</channel></rss>";
          return { ok: true, status: 200, text: async () => body };
        }
      }), advance);
      assert.deepEqual(result.map(item => item.hash).sort(),
        config.media === "dub" ? ["a".repeat(40), "b".repeat(40)] : ["c".repeat(40)],
        "only scoped dub tags pass dubs; subtitle results exclude every dub tag");
      assert.equal(calls, 1, "the classification fix needs no extra requests");
    }
  });

  test(provider + ": keep genuine empty results and successful fallback results", async t => {
    const advance = clock(t);
    for (const method of ["single", "batch", "movie"]) {
      const empty = await settle(extension[method]({ ...query, fetch: async () => response() }), advance);
      assert.deepEqual(empty, []);
      let calls = 0;
      const result = await settle(extension[method]({
        titles: ["Target Example Season 2", "Alternate Name"], episode: 8, fetch: async () => {
          calls++;
          return calls === 1 ? { ok: false, status: 503 } : response([goodTitle]);
        }
      }), advance);
      assert.deepEqual(result.map(item => item.hash), ["1".repeat(40)],
        "usable results still win over an earlier failed request");
      assert.equal(calls, 2, "stop as soon as usable results arrive");
    }
  });
}
