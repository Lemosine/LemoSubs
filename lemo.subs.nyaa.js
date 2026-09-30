const DOMAIN = "https://nyaa.si";
const CATEGORY = "1_2";
const FILTER = "0";
const TIMEOUT_MS = 6000;
const MAX_SEARCH_TITLES = 3;
const feedRequests = new WeakMap();
const MAX_SAFE_BATCH_EPISODES = 36;
const TITLE_STOP_WORDS = new Set(["a", "an", "and", "cour", "of", "part", "season", "the", "to"]);

const TRACKERS = [
  "http://nyaa.tracker.wf:7777/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce"
].map(tracker => `&tr=${encodeURIComponent(tracker)}`).join("");

const DUB_AUDIO_RE = /\b(dubbed|dual[-\s._]?audio|english[-\s._]?(?:dub|audio)|eng[-\s._]?(?:dub|audio)|multi[-\s._]?audio)\b/i;

const COUR_RELEASE_MAPPINGS = [
  {
    anilistId: 199221,
    cour: 3,
    title: /\bdr\.?\s*stone\s+science\s+future\b/i,
    season: 4,
    offsets: { 1: 0, 2: 12, 3: 24 }
  }
];

function decodeEntities(value) {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

function tag(item, name) {
  const match = item.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function nyaaTag(item, name) {
  const match = item.match(new RegExp(`<nyaa:${name}>([\\s\\S]*?)<\\/nyaa:${name}>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function parseSize(size) {
  const match = String(size).match(/([\d.]+)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB)/i);
  if (!match) return 0;

  const value = Number.parseFloat(match[1]);
  const units = { KIB: 1024, KB: 1024, MIB: 1024 ** 2, MB: 1024 ** 2, GIB: 1024 ** 3, GB: 1024 ** 3, TIB: 1024 ** 4, TB: 1024 ** 4 };
  return Math.round(value * (units[match[2].toUpperCase()] ?? 0));
}

function magnet(hash, title) {
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}${TRACKERS}`;
}

function buildUrl(query) {
  const params = new URLSearchParams({
    page: "rss",
    q: query,
    c: CATEGORY,
    f: FILTER,
    s: "seeders",
    o: "desc"
  });

  return `${DOMAIN}/?${params.toString()}`;
}

function fetchText(request, url) {
  let pending = feedRequests.get(request);
  if (!pending) {
    pending = new Map();
    feedRequests.set(request, pending);
  }
  if (pending.has(url)) return pending.get(url);
  const task = requestText(request, url).finally(() => pending.delete(url));
  pending.set(url, task);
  return task;
}

async function requestText(request, url) {
  const controller = new AbortController();
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Nyaa did not respond in time."));
    }, TIMEOUT_MS);
  });

  const response = (async () => {
    const res = await request(url, {
      signal: controller.signal,
      headers: { Accept: "application/rss+xml, application/xml, text/xml" }
    });

    if (!res.ok) throw new Error(`Nyaa returned HTTP ${res.status}.`);
    const xml = await res.text();
    if (!/<rss\b/i.test(xml)) throw new Error("Nyaa returned a page instead of an RSS feed.");
    return xml;
  })();

  response.catch(() => {});

  try {
    return await Promise.race([response, timeout]);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Nyaa did not respond in time.");
    throw new Error(`Could not reach Nyaa: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function parseRss(xml, query) {
  if (!xml.includes("<rss")) return [];

  const expectedSeason = query.expectedSeason;
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items
    .map(item => {
      const title = tag(item, "title");
      const hash = nyaaTag(item, "infoHash").toLowerCase();
      if (!title || !hash || DUB_AUDIO_RE.test(title)) return null;
      if (!titleMatches(title, query.titles)) return null;
      if (!seasonMatches(title, expectedSeason)) return null;
      if (query.episode && !acceptableEpisodeResult(title, query.episode)) return null;
      const episodeRange = query.episode && rangeForEpisode(title, query.episode);
      const exactEpisode = query.episode && !episodeRange && episodeMatches(title, query.episode);

      const seeders = Number.parseInt(nyaaTag(item, "seeders") || "0", 10);
      const leechers = Number.parseInt(nyaaTag(item, "leechers") || "0", 10);
      const downloads = Number.parseInt(nyaaTag(item, "downloads") || "0", 10);
      const pubDate = tag(item, "pubDate");

      return {
        title,
        link: magnet(hash, title),
        hash,
        seeders: seeders >= 30000 ? 0 : seeders,
        leechers: leechers >= 30000 ? 0 : leechers,
        downloads,
        size: parseSize(nyaaTag(item, "size")),
        date: pubDate ? new Date(pubDate) : new Date(0),
        accuracy: query.episode ? exactEpisode ? "high" : "medium" : "medium",
        type: isBatchTitle(title) ? "batch" : undefined
      };
    })
    .filter(Boolean);
}

function episodeMatches(title, episode) {
  const target = Number.parseInt(episode, 10);
  if (!Number.isFinite(target)) return false;

  const text = String(title);
  const explicitEpisodes = [
    ...text.matchAll(/\bS\d{1,2}\s*E\s*(\d{1,4})(?!\d)/gi),
    ...text.matchAll(/\b(?:E|EP|EPS|Episode)\s*\.?\s*(\d{1,4})(?!\d)/gi)
  ];

  if (explicitEpisodes.length) {
    return explicitEpisodes.some(match => Number.parseInt(match[1], 10) === target);
  }

  for (const match of text.matchAll(/\d{1,4}/g)) {
    const value = match[0];
    const parsed = Number.parseInt(value, 10);
    if (parsed !== target) continue;

    const index = match.index ?? 0;
    const before = text[index - 1] ?? "";
    const suffix = text.slice(index + value.length);
    const after = suffix[0] ?? "";

    if (value.length === 4 && parsed >= 1900 && parsed <= 2099) continue;
    if (/[A-Za-z]/.test(before)) continue;
    if (/[A-Za-z]/.test(after) && !/^v\d/i.test(suffix)) continue;
    return true;
  }

  return false;
}

function rangeForEpisode(title, episode) {
  const ep = Number.parseInt(episode, 10);
  if (!Number.isFinite(ep)) return null;

  const ranges = [
    ...title.matchAll(/\bS\d{1,2}E(\d{1,4})\s*[-~\u2013\u2014]\s*E?(\d{1,4})\b/gi),
    ...title.matchAll(/\b(?:E|EP|EPS|Episodes?)?\s*(\d{1,4})\s*[-~\u2013\u2014]\s*(?:E|EP|EPS|Episodes?)?\s*(\d{1,4})\b/gi)
  ];

  for (const match of ranges) {
    const start = Number.parseInt(match[1], 10);
    const end = Number.parseInt(match[2], 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start >= 1900 && end >= 1900) continue;

    const low = Math.min(start, end);
    const high = Math.max(start, end);
    const span = high - low + 1;
    if (span < 2) continue;
    if (ep >= low && ep <= high) return { start: low, end: high, span };
  }

  return null;
}

function acceptableEpisodeResult(title, episode) {
  if (!episode) return true;
  const range = rangeForEpisode(title, episode);
  if (range) return range.span <= MAX_SAFE_BATCH_EPISODES;
  return episodeMatches(title, episode);
}

function isBatchTitle(title) {
  return /batch|complete|\b\d{1,3}\s*[-~\u2013\u2014]\s*\d{1,3}\b|\bS\d{1,2}E\d{1,3}\s*[-~\u2013\u2014]\s*E?\d{1,3}\b/i.test(title);
}

function seasonNumber(title) {
  const season = title.match(/\bseason\s+(\d+)\b/i);
  if (season) return Number.parseInt(season[1], 10);

  const ordinal = title.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i);
  return ordinal ? Number.parseInt(ordinal[1], 10) : null;
}

function courNumber(title) {
  const cour = title.match(/\b(?:cour|part)\s+(\d+)\b/i)
    ?? title.match(/(\d+)\s*\u30af\u30fc\u30eb/);
  return cour ? Number.parseInt(cour[1], 10) : null;
}

function releaseNumbering(titles, episode, anilistId) {
  const joined = titles.join(" ");
  const localEpisode = Number.parseInt(episode, 10);
  const numericAnilistId = Number.parseInt(anilistId, 10);
  const mapping = COUR_RELEASE_MAPPINGS.find(item => (
    item.anilistId === numericAnilistId || item.title.test(joined)
  ));
  const cour = courNumber(joined)
    ?? (mapping?.anilistId === numericAnilistId ? mapping.cour : null);
  const offset = mapping?.offsets[cour];

  if (mapping && Number.isFinite(localEpisode) && Number.isFinite(offset)) {
    return { season: mapping.season, episode: localEpisode + offset };
  }

  return { season: seasonNumber(joined), episode };
}

function resultSeasonNumber(title) {
  const absolute = title.match(/\bS(\d{1,2})E\d{1,4}\b/i);
  if (absolute) return Number.parseInt(absolute[1], 10);

  const short = title.match(/\bS(\d{1,2})\b/i);
  if (short) return Number.parseInt(short[1], 10);

  return seasonNumber(title);
}

function seasonMatches(title, expectedSeason) {
  if (!expectedSeason) return true;

  const actualSeason = resultSeasonNumber(title);
  if (actualSeason) return actualSeason === expectedSeason;

  return expectedSeason === 1;
}

function titleVariants(titles) {
  const variants = [];

  for (const title of titles) {
    const season = seasonNumber(title);
    const stripped = title
      .replace(/\s*(?:season\s+\d+|\d+(?:st|nd|rd|th)\s+season|(?:cour|part)\s+\d+|\d+\s*\u30af\u30fc\u30eb)\s*$/i, "")
      .trim();
    const cleaned = stripped.replace(/[.:]/g, "").replace(/\s+/g, " ").trim();

    if (stripped && stripped !== title) variants.push(stripped);
    if (cleaned && cleaned !== stripped) variants.push(cleaned);
    if (season && stripped) variants.push(`${stripped} S${season}`);
    if (season && cleaned && cleaned !== stripped) variants.push(`${cleaned} S${season}`);
    variants.push(title);
  }

  return [...new Set(variants)].slice(0, 8);
}

function queryTitles(query) {
  const mediaTitles = query.media?.title ? Object.values(query.media.title) : [];
  const synonyms = Array.isArray(query.media?.synonyms) ? query.media.synonyms : [];
  const titles = Array.isArray(query.titles) ? query.titles : [];

  return [...new Set([...mediaTitles, ...titles, ...synonyms]
    .filter(title => typeof title === "string" && title.trim())
    .map(title => title.trim()))];
}

function normalizeTitle(value) {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function titleMatches(resultTitle, titles = []) {
  const result = normalizeTitle(resultTitle);
  const resultTokens = new Set(result.split(" ").filter(Boolean));

  return titleVariants(titles).some(title => {
    const candidate = normalizeTitle(title);
    if (!candidate) return false;

    const tokens = candidate.split(" ").filter(Boolean);
    if (tokens.length === 1) return resultTokens.has(tokens[0]);
    if (result.includes(candidate)) return true;

    const significant = tokens.filter(token => token.length > 1 && !TITLE_STOP_WORDS.has(token));
    return significant.length >= 2 && significant.every(token => resultTokens.has(token));
  });
}

function applyExclusions(results, exclusions = []) {
  const blocked = exclusions.map(item => item.toLowerCase()).filter(Boolean);
  if (!blocked.length) return results;
  return results.filter(result => !blocked.some(item => result.title.toLowerCase().includes(item)));
}

function dedupe(results) {
  const seen = new Set();
  return results
    .filter(result => {
      if (seen.has(result.hash)) return false;
      seen.add(result.hash);
      return true;
    })
    .sort((a, b) => b.seeders - a.seeders);
}

async function search(query, isBatch = false) {
  const availableTitles = queryTitles(query);
  if (!availableTitles.length) return [];

  const request = query.fetch ?? fetch;
  // Give each canonical language a query before trying another spelling.
  const titles = [...new Set(availableTitles.map(title => normalizeTitle(titleVariants([title])[0])).filter(Boolean))]
    .slice(0, MAX_SEARCH_TITLES);
  if (!titles.length) return [];
  const numbering = releaseNumbering(availableTitles, query.episode, query.anilistId);
  const episode = numbering.episode == null ? null : String(numbering.episode).padStart(2, "0");
  const season = numbering.season;
  const normalizedQuery = { ...query, titles: availableTitles, episode: numbering.episode, expectedSeason: season };
  const episodeToken = episode ? `S${String(season ?? 1).padStart(2, "0")}E${episode}` : null;
  // Nyaa tokenizes S01E08 separately from 08; query both forms for every alias.
  const searches = episode && !isBatch
    ? titles.flatMap(title => [`${title} ${episodeToken}`, `${title} ${episode}`])
    : [];
  // Broad queries also find episode ranges; audio and episode checks stay local.
  const attempts = [...new Set([...searches, ...titles])];
  const settled = await Promise.allSettled(attempts.map(async item => {
    const xml = await fetchText(request, buildUrl(item));
    return parseRss(xml, normalizedQuery);
  }));

  const results = settled
    .filter(item => item.status === "fulfilled")
    .flatMap(item => item.value);

  if (settled.every(item => item.status === "rejected")) throw settled[0].reason;

  return applyExclusions(dedupe(results), normalizedQuery.exclusions);
}

export default {
  async test(query = {}) {
    const request = query.fetch ?? fetch;
    const xml = await fetchText(request, buildUrl("SubsPlease"));
    return xml.includes("<rss");
  },

  async single(query) {
    return search(query);
  },

  async batch(query) {
    return search(query, true);
  },

  async movie(query) {
    return search(query);
  }
};
