const API_URL = "https://releases.moe/api/collections/entries/records";
const MAX_SAFE_BATCH_EPISODES = 36;

const TRACKERS = [
  "http://nyaa.tracker.wf:7777/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce"
].map(tracker => `&tr=${encodeURIComponent(tracker)}`).join("");

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

function videoFiles(files) {
  return files.filter(file => /\.(?:mkv|mp4|avi|webm|m4v|mov)$/i.test(file?.name ?? ""));
}

function queryTitles(titles, media) {
  const mediaTitles = media?.title ? Object.values(media.title) : [];
  const synonyms = Array.isArray(media?.synonyms) ? media.synonyms : [];
  const supplied = Array.isArray(titles) ? titles : [];

  return [...new Set([...mediaTitles, ...supplied, ...synonyms]
    .filter(title => typeof title === "string" && title.trim())
    .map(title => title.trim()))];
}

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

function magnet(hash, title) {
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}${TRACKERS}`;
}

export default new class SeaDexSubs {
  url = API_URL;

  async single({ anilistId, titles, media, episode, fetch: request = fetch }) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return [];
    const availableTitles = queryTitles(titles, media);
    if (!anilistId || !availableTitles.length) return [];

    const filter = encodeURIComponent(`alID="${anilistId}"`);
    const data = await fetchJson(request, `${this.url}?page=1&perPage=200&filter=${filter}&skipTotal=1&expand=trs`);
    const items = Array.isArray(data?.items) ? data.items : [];
    const trs = Array.isArray(items[0]?.expand?.trs) ? items[0].expand.trs : [];
    if (!trs.length) return [];

    return trs
      .filter(torrent => {
        const files = Array.isArray(torrent.files) ? torrent.files : [];
        const videos = videoFiles(files);
        const matches = episode
          ? videos.filter(file => episodeMatches(file.name ?? "", episode))
          : [];
        const safeEpisodeMatch = !episode || (
          matches.length === 1 &&
          (videos.length === 1 || videos.length <= MAX_SAFE_BATCH_EPISODES)
        );

        return (
          torrent.infoHash &&
          "<redacted>" !== torrent.infoHash &&
          !torrent.dualAudio &&
          videos.length > 0 &&
          safeEpisodeMatch
        );
      })
      .map(torrent => {
        const files = Array.isArray(torrent.files) ? torrent.files : [];
        const videos = videoFiles(files);
        const title = videos.length === 1 && videos[0]?.name
          ? videos[0].name
          : `[${torrent.releaseGroup ?? "SeaDex"}] ${availableTitles[0]} English Subs`;

        return {
          hash: torrent.infoHash,
          link: magnet(torrent.infoHash, title),
          title,
          size: files.reduce((prev, curr) => prev + (curr.length ?? 0), 0),
          type: videos.length > 1 ? "batch" : torrent.isBest ? "best" : "alt",
          date: new Date(torrent.created),
          seeders: 0,
          leechers: 0,
          downloads: 0,
          accuracy: "high"
        };
      });
  }

  async batch() {
    return [];
  }

  async movie() {
    return [];
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
