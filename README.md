# Lemo Subs

Hayase torrent extensions focused on English-subtitled anime releases.

Import URL:

```text
https://raw.githubusercontent.com/Lemosine/LemoSubs/main/index.json
```

Sources:

- SeaDex/Releases.moe
- Nyaa.si
- NekoBT
- AnimeTosho archive
- Knaben

AnimeTosho stopped adding releases in May 2026 and announced that its feed/API
will close in early-to-mid October 2026. Its connection check tests filtered
archive access only; it cannot provide new releases. See the
[provider's shutdown notice](https://animetosho.org/).

Requests, including response bodies, have a six-second limit. NekoBT uses two
request stages, so a search can take up to about twelve seconds. Nyaa shares
pending single/batch requests and searches up to three title aliases, stopping
when a query returns usable matches. Its requests run one at a time, at least
one second apart, with a fourteen-second total search deadline.

Nyaa caches up to 32 successful feeds for one minute, reapplying the current
episode/audio filters on reuse. HTTP 429 stops queued requests and starts a
cooldown using the server's Retry-After header, or one minute if it is absent
or invalid. The error displays the remaining wait; failed responses are not
cached. Network failures remain distinct from searches with no matches.

The queue, cache and cooldown last for this extension's loaded lifetime; other
installed Nyaa extensions have their own requests. Avoid repeated refreshes
during a rate limit. These protections reduce request pressure but cannot
remove a provider-side restriction.

Knaben is a conservative backup using its public v2 search API, without keys
or a debrid account. It keeps Nyaa's translated anime category or explicitly
English-subtitled anime titles, excluding dub/dual/multi-audio labels and
raw/non-English categories. Unknown language results are omitted. Season,
episode, resolution and exclusion filters run locally, and large episode
packs remain excluded. It uses the same pacing, cache, cooldown and timeout
limits as Nyaa. Public magnets are built locally; source download URLs are
not fetched. Titles/categories are evidence, not a probe of the media tracks.

Initial checks found subtitle candidates for Liar Game episode 8 and Black
Clover 132 in 1080p. Coverage overlaps other providers; this is a backup,
not a promise of additional releases.

StremThru Torz's public P2P lookup also worked, but is not included: its
file-indexed series packs need a verified Hayase file-selection adapter first.
No Torz/debrid credentials are used or stored.

Run the offline regression checks with Node.js:

```text
node tests/batch-fallback.mjs
node tests/network-search.mjs
node --test tests/rate-limit.mjs
node --test tests/knaben.mjs
```
