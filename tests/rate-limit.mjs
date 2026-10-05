import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";

const configs = JSON.parse(await readFile(new URL("../index.json", import.meta.url), "utf8"));
const config = configs.find(entry => entry.name.endsWith(" Nyaa"));
const filename = new URL(config.code).pathname.split("/").at(-1);
const source = await readFile(new URL("../" + filename, import.meta.url), "utf8");
const nyaa = (await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"))).default;
const audio = config.media === "dub" ? "[English Dub]" : "[MultiSub]";
const empty = "<rss><channel></channel></rss>";
const feed = "<rss><channel>" + [8, 9].map((episode, i) =>
  "<item><title>Example Show S01E0" + episode + " 1080p " + audio + "</title>" +
  "<nyaa:infoHash>" + (i ? "b" : "a").repeat(40) + "</nyaa:infoHash></item>"
).join("") + "</channel></rss>";
const response = (xml = feed) => ({ ok: true, status: 200, text: async () => xml });
const query = fetch => ({ titles: ["Example Show"], episode: 8, fetch });
const epoch = Date.UTC(2026, 0, 1);

function clock(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: epoch });
  return async ms => {
    t.mock.timers.tick(ms);
    await setImmediate();
  };
}

async function settle(promise, advance, limit = 15000) {
  let result;
  promise.then(value => { result = { value }; }, error => { result = { error }; });
  await setImmediate();
  for (let elapsed = 0; !result && elapsed < limit; elapsed += 100) await advance(100);
  assert.ok(result, "operation must settle within its search deadline");
  if (result.error) throw result.error;
  return result.value;
}

test("single/batch share paced requests, bodies and cached feeds without mixing episodes", async t => {
  const advance = clock(t);
  const starts = [];
  const ends = [];
  let active = 0;
  let maxActive = 0;
  const fetch = async () => {
    starts.push(Date.now());
    maxActive = Math.max(maxActive, ++active);
    return { ok: true, status: 200, text: async () => {
      await new Promise(resolve => setTimeout(resolve, 1500));
      active--;
      ends.push(Date.now());
      return feed;
    }};
  };
  const results = await settle(Promise.all([
    nyaa.single(query(fetch)), nyaa.single(query(fetch)), nyaa.batch(query(fetch))
  ]), advance);
  assert.equal(starts.length, 2);
  assert.equal(maxActive, 1, "body reading is part of the serialized request");
  assert.ok(starts[1] - starts[0] >= 1000);
  assert.ok(starts[1] >= ends[0]);
  for (const result of results) assert.deepEqual(result.map(item => item.hash), ["a".repeat(40)]);
  await settle(nyaa.single(query(fetch)), advance);
  const next = await settle(nyaa.batch({ ...query(fetch), episode: 9 }), advance);
  assert.deepEqual(next.map(item => item.hash), ["b".repeat(40)]);
  assert.equal(starts.length, 2, "cache raw feeds, then apply the current episode filters");
});

test("fast requests are spaced, and searches stop after finding usable results", async t => {
  const advance = clock(t);
  const starts = [];
  const fetch = async () => { starts.push(Date.now()); return response(); };
  await settle(Promise.all([nyaa.single(query(fetch)), nyaa.batch(query(fetch))]), advance);
  assert.equal(starts.length, 2, "do not try every alias after a successful result");
  assert.ok(starts[1] - starts[0] >= 1000);
});

for (const [header, delay] of [
  [null, 60000], ["invalid", 60000], ["5", 5000],
  [new Date(epoch + 7000).toUTCString(), 7000]
]) {
  test("429 stops queued requests and honors Retry-After " + String(header), async t => {
    const advance = clock(t);
    let calls = 0;
    const fetch = async () => {
      if (++calls > 1) return response();
      return { ok: false, status: 429, headers: new Headers(header ? { "Retry-After": header } : {}) };
    };
    const results = await settle(Promise.allSettled([
      nyaa.single(query(fetch)), nyaa.batch(query(fetch)), nyaa.test({ fetch })
    ]), advance);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      assert.match(result.reason.message, /HTTP 429/);
    }
    assert.equal(calls, 1, "queued searches and health checks must stop on the first 429");
    await advance(epoch + delay - Date.now() - 1);
    await assert.rejects(nyaa.single(query(fetch)), /Wait 1 seconds/);
    assert.equal(calls, 1, "searching again must not extend or bypass the cooldown");
    await advance(1);
    const recovered = await settle(nyaa.single(query(fetch)), advance);
    assert.equal(recovered.length, 1);
    assert.equal(calls, 2, "the 429 response is not cached");
  });
}

test("successful cached results remain usable during a cooldown", async t => {
  const advance = clock(t);
  let calls = 0;
  const fetch = async () => ++calls === 1 ? response() : { ok: false, status: 429 };
  await settle(nyaa.batch(query(fetch)), advance);
  await settle(assert.rejects(nyaa.single(query(fetch)), /HTTP 429/), advance);
  const cached = await settle(nyaa.batch(query(fetch)), advance);
  assert.equal(cached.length, 1);
  assert.equal(calls, 2);
});

test("successful feed cache expires after a minute and is bounded", async t => {
  const advance = clock(t);
  let calls = 0;
  const fetch = async () => { calls++; return response(empty); };
  const search = i => nyaa.batch({ titles: ["catalog" + i], fetch });
  for (let i = 0; i < 33; i++) await settle(search(i), advance);
  assert.equal(calls, 33);
  await settle(search(32), advance);
  assert.equal(calls, 33, "recent cached feeds should be reused");
  await settle(search(0), advance);
  assert.equal(calls, 34, "oldest entry must be evicted after 32 feeds");
  await advance(60000);
  await settle(search(0), advance);
  assert.equal(calls, 35, "expired feeds must be fetched again");
});

test("search deadline includes queue time and abandons queued work", async t => {
  const advance = clock(t);
  const starts = [];
  const signals = [];
  const fetch = async (_url, options) => {
    starts.push(Date.now());
    signals.push(options.signal);
    return { ok: true, status: 200, text: () => new Promise(() => {}) };
  };
  const queries = Array.from({ length: 5 }, (_, i) =>
    nyaa.single({ titles: ["catalog" + i], episode: 8, fetch }));
  const results = await settle(Promise.allSettled(queries), advance);
  assert.ok(Date.now() - epoch <= 14000, "return before Hayase's twenty-second timeout");
  for (const result of results) {
    assert.equal(result.status, "rejected");
    assert.match(result.reason.message, /timed out/);
  }
  assert.equal(starts.length, 3);
  assert.ok(signals.every(signal => signal.aborted));
  await advance(60000);
  assert.equal(starts.length, 3, "abandoned jobs must not send late requests");
});

