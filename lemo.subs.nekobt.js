const QUALITIES = ["1080", "720", "540", "480"];
const DUB_AUDIO_RE = /\b(dubbed|dual[-\s._]?audio|english[-\s._]?(?:dub|audio)|eng[-\s._]?(?:dub|audio)|multi[-\s._]?audio)\b/i;
const ENGLISH_AUDIO_TAG_RE = /\bA=[^;]*\b(?:en|enm)\b/i;

async function fetchJson(request, url) {
  const res = await request(url, {
    headers: { Accept: "application/json" }
  });

  if (!res.ok) return null;

  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function decoded(value) {
  try {
    return decodeURIComponent(value ?? "");
  } catch {
    return value ?? "";
  }
}

function hasEnglishAudio(entry) {
  const text = `${entry.title ?? ""} ${decoded(entry.magnet)}`;
  return DUB_AUDIO_RE.test(text) || ENGLISH_AUDIO_TAG_RE.test(text);
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
    ...title.matchAll(/\bS\d{1,2}E(\d{1,4})\s*[-~]\s*E?(\d{1,4})\b/gi),
    ...title.matchAll(/\b(\d{1,4})\s*[-~]\s*(\d{1,4})\b/g)
  ];

  for (const match of ranges) {
    const start = Number.parseInt(match[1], 10);
    const end = Number.parseInt(match[2], 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    const low = Math.min(start, end);
    const high = Math.max(start, end);
    if (ep >= low && ep <= high) return { start: low, end: high, span: high - low + 1 };
  }

  return null;
}

function acceptableEpisodeResult(title, episode) {
  if (!episode) return true;
  if (rangeForEpisode(title, episode)) return false;
  return episodeMatches(title, episode);
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

export default new class NekoBTSubs {
  url = atob("aHR0cHM6Ly9uZWtvYnQudG8vYXBpL3YxLw==");

  async _fetch(request, search) {
    const json = await fetchJson(request, `${this.url}torrents/search?${search}`);

    if (json?.error) throw new Error("NekoBT: " + json.message);
    if (!json?.data) return null;
    return json.data;
  }

  async single({
    tvdbId,
    tvdbEId,
    tmdbId,
    episode,
    fetch: request = fetch,
    resolution,
    exclusions = []
  }) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return [];

    const mediaParams = new URLSearchParams({ limit: "1" });
    if (tvdbId) mediaParams.append("tvdbid", tvdbId.toString());
    if (tmdbId) mediaParams.append("tmdbid", tmdbId);

    const mappings = await this._fetch(request, mediaParams);
    if (!mappings?.media) return [];

    const ep = mappings.media.episodes?.find(item => item.tvdbId === tvdbEId)
      ?? mappings.media.episodes?.find(item => item.episode === episode);

    const searches = [
      new URLSearchParams({
        media_id: mappings.media.id,
        audio_lang: "ja",
        sub_lang: "en,enm"
      }),
      new URLSearchParams({
        media_id: mappings.media.id,
        audio_lang: "ja",
        fansub_lang: "en,enm"
      })
    ];

    for (const searchParams of searches) {
      if (ep?.id) searchParams.append("episode_ids", ep.id.toString());
    }

    const high = ep?.tvdbId === tvdbEId;
    const lowerExclusions = exclusions.map(item => item.toLowerCase());
    const effectiveExclusions = resolution
      ? lowerExclusions.concat(...QUALITIES.filter(item => item !== resolution).map(item => `${item}p`))
      : lowerExclusions;

    const settled = await Promise.allSettled(searches.map(params => this._fetch(request, params)));
    const entries = settled
      .filter(item => item.status === "fulfilled")
      .flatMap(item => item.value?.results ?? []);

    return dedupe(entries
      .filter(entry => {
        if (!acceptableEpisodeResult(entry.title, episode)) return false;
        if (hasEnglishAudio(entry)) return false;
        if (!effectiveExclusions.length) return true;
        const lowerTitle = entry.title.toLowerCase();
        return !effectiveExclusions.some(item => lowerTitle.includes(item));
      })
      .map(entry => ({
        title: entry.title,
        link: `${this.url}torrents/${entry.id}/download?public=true`,
        seeders: Number(entry.seeders),
        leechers: Number(entry.leechers),
        downloads: Number(entry.completed),
        hash: entry.infohash,
        size: Number(entry.filesize),
        accuracy: high ? "high" : "medium",
        type: (entry.level ?? 0) >= 3 ? "alt" : entry.batch ? "batch" : undefined,
        date: new Date(entry.uploaded_at)
      })));
  }

  async batch() {
    return [];
  }

  async movie() {
    return [];
  }

  async test() {
    try {
      const { ok } = await fetch(this.url + "announcements");
      if (!ok) throw new Error(`Failed to load data from ${this.url}! Is the site down?`);
      return true;
    } catch {
      throw new Error(`Could not reach ${this.url}! Does the site work in your region?`);
    }
  }
}();
