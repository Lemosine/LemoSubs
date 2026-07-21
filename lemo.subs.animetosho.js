const QUALITIES = ["1080", "720", "540", "480"];
const DUB_AUDIO_RE = /\b(dubbed|dual[-\s._]?audio|dual|english[-\s._]?(?:dub|audio)|eng[-\s._]?(?:dub|audio)|multi[-\s._]?audio)\b/i;
const DUB_EXCLUSIONS = ["dubbed", "dual audio", "dual-audio", "dual.audio", "dual_audio", "multi-audio", "multi audio", "english dub", "eng dub"];

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

export default new class ToshoSubs {
  url = atob("aHR0cHM6Ly9mZWVkLmFuaW1ldG9zaG8ub3JnL2pzb24=");

  _buildQuery({ resolution, exclusions = [] }) {
    const excluded = DUB_EXCLUSIONS.concat(Array.isArray(exclusions) ? exclusions : []);
    const parts = [];

    if (excluded.length) parts.push(`!("${excluded.join('"|"')}")`);
    if (resolution) parts.push(`!(*${QUALITIES.filter(quality => quality !== resolution).join("*|*")}*)`);

    return parts.length ? `&qx=1&q=${parts.join("")}` : "";
  }

  map(entries, batch = false, useTorrent = false) {
    return entries
      .filter(entry => !DUB_AUDIO_RE.test(entry.title || entry.torrent_name || ""))
      .map(entry => ({
        title: entry.title || entry.torrent_name,
        link: useTorrent ? entry.torrent_url : entry.magnet_uri,
        seeders: (entry.seeders || 0) >= 3e4 ? 0 : entry.seeders || 0,
        leechers: (entry.leechers || 0) >= 3e4 ? 0 : entry.leechers || 0,
        downloads: entry.torrent_downloaded_count || 0,
        hash: entry.info_hash,
        size: entry.total_size,
        accuracy: entry.anidb_fid && !batch ? "high" : "medium",
        type: batch ? "batch" : undefined,
        date: new Date(1e3 * entry.timestamp)
      }));
  }

  async single({ anidbEid, resolution, exclusions = [], fetch: request = fetch }, options) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return [];
    if (!anidbEid) return [];

    const query = this._buildQuery({ resolution, exclusions });
    const data = await fetchJson(request, this.url + "?eid=" + anidbEid + query);
    return Array.isArray(data) && data.length ? this.map(data, false, options?.useTorrent) : [];
  }

  async batch({ anidbAid, resolution, exclusions = [], episode, fetch: request = fetch }, options) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return [];
    if (!anidbAid) return [];

    const query = this._buildQuery({ resolution, exclusions });
    const data = await fetchJson(request, this.url + "?order=size-d&aid=" + anidbAid + query);
    const entries = Array.isArray(data)
      ? data.filter(entry => (
        entry.num_files >= Math.min(24, Math.max(2, episode ?? 1)) &&
        acceptableEpisodeResult(entry.title || entry.torrent_name || "", episode)
      ))
      : [];
    return entries.length ? this.map(entries, true, options?.useTorrent) : [];
  }

  async movie({ anidbAid, resolution, exclusions = [], fetch: request = fetch }, options) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return [];
    if (!anidbAid) return [];

    const query = this._buildQuery({ resolution, exclusions });
    const data = await fetchJson(request, this.url + "?aid=" + anidbAid + query);
    return Array.isArray(data) && data.length ? this.map(data, false, options?.useTorrent) : [];
  }

  async test() {
    try {
      if (!(await fetch(this.url)).ok) throw new Error(`Failed to load data from ${this.url}! Is the site down?`);
      return true;
    } catch {
      throw new Error(`Could not reach ${this.url}! Does the site work in your region?`);
    }
  }
}();
