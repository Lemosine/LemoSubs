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
      ? data.filter(entry => entry.num_files >= Math.min(24, Math.max(2, episode ?? 1)))
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
