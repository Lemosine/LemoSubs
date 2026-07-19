const API_URL = "https://releases.moe/api/collections/entries/records";

const TRACKERS = [
  "http://nyaa.tracker.wf:7777/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce"
].map(tracker => `&tr=${encodeURIComponent(tracker)}`).join("");

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

  async single({ anilistId, titles, fetch: request = fetch }) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return [];
    if (!anilistId || !titles?.length) return [];

    const filter = encodeURIComponent(`alID="${anilistId}"`);
    const data = await fetchJson(request, `${this.url}?page=1&perPage=200&filter=${filter}&skipTotal=1&expand=trs`);
    const items = Array.isArray(data?.items) ? data.items : [];
    const trs = Array.isArray(items[0]?.expand?.trs) ? items[0].expand.trs : [];
    if (!trs.length) return [];

    return trs
      .filter(torrent => {
        const files = Array.isArray(torrent.files) ? torrent.files : [];

        return (
          torrent.infoHash &&
          "<redacted>" !== torrent.infoHash &&
          !torrent.dualAudio &&
          files.length > 0
        );
      })
      .map(torrent => {
        const files = Array.isArray(torrent.files) ? torrent.files : [];
        const title = 1 === files.length && files[0]?.name
          ? files[0].name
          : `[${torrent.releaseGroup ?? "SeaDex"}] ${titles[0]} English Subs`;

        return {
          hash: torrent.infoHash,
          link: magnet(torrent.infoHash, title),
          title,
          size: files.reduce((prev, curr) => prev + (curr.length ?? 0), 0),
          type: torrent.isBest ? "best" : "alt",
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
