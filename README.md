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
- AnimeTosho (retired; disable this entry)
- Knaben

AnimeTosho's feed no longer resolves as of October 12, 2026, consistent with
the [provider's shutdown notice](https://animetosho.org/). Its legacy ID remains
in the manifest so installed copies receive a retirement update. It makes no
network requests or episode searches; its health check explicitly reports
retirement instead of claiming the service is healthy. Disable the
AnimeTosho (Retired) entry in Hayase. Removing it from this manifest alone
would leave already-installed code unchanged.

Requests, including response bodies, have a six-second limit. NekoBT uses two
request stages, so a search can take up to about twelve seconds. Nyaa shares
pending single/batch requests and searches up to three title aliases, stopping
when a query returns usable matches. Its requests run one at a time, at least
one second apart, with a fourteen-second total search deadline.

SeaDex 0.1.6 registers its records API path in Hayase's manifest:
`https://releases.moe/api/collections/entries/`. This lets the desktop host
handle responses that omit cross-origin headers, which otherwise appear as
"Failed to fetch". It does not bypass site access restrictions or fix outages.
After updating, fully quit and reopen Hayase to load the new permission.
Connection failures, HTTP errors and malformed responses remain errors, not
"no matches". Episode and audio filters are unchanged; no automatic retries,
proxy, credentials or extra endpoints were added.

SeaDex 0.1.7 also admits large series packs when their file list proves
a complete, unique `S01E1...N` sequence matching the known catalog episode
count. This restores long-running series previously blocked by the blanket
36-video limit. The main filename stem must remain consistent; season-zero
extras are separate from the episode count. Missing episodes, duplicates,
restarted seasons, ranges, fractional episodes and ambiguous target matches
stay excluded. Unverified large packs from title-only searches remain blocked.
The same rule applies to Lemo Dubs and Lemo Subs with their own audio filters.

Nyaa caches up to 32 successful feeds for one minute, reapplying the current
episode/audio filters on reuse. HTTP 429 stops queued requests and starts a
cooldown using the server's Retry-After header, or one minute if it is absent
or invalid. The error displays the remaining wait; failed responses are not
cached. Network failures remain distinct from searches with no matches.

Nyaa and Knaben retain all supplied title aliases during local
result filtering. Earlier variant limits could discard an alias that was
actually searched. The network budget remains three aliases and at most nine
single/movie queries or three batch queries, with the same deadline.
When no usable result is found, a failed query now remains an error even if
another alias returned an empty response. Successful fallback results still
return normally. Audio, season and episode requirements are unchanged.

Nyaa 0.1.9 and Knaben 0.1.3 recognize a standalone bracketed `[Dub]`
label in Nyaa's English-translated anime category. Knaben requires both the
Nyaa tracker ID and its translated category for this fallback; other sources
still require explicit English audio labels. Dub tags are excluded from
Lemo Subs. Nyaa also rejects explicit RSS categories outside its requested
English-translated category. MultiSub alone is not evidence of English audio.
These are source-label checks, not verification of the media's audio tracks.

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

Knaben 0.1.1 adds the Base64-encoded public API URL to the manifest so Hayase's
desktop host can register its cross-origin permission. Permission is limited
to `https://api.knaben.org/v2/`; no proxy, private endpoint or credentials are
involved. Earlier Node-only checks missed this host requirement.
After updating the repository in Hayase, fully quit and reopen the app to
reload the manifest permissions. Check that Knaben shows version 0.1.3.

Initial checks found subtitle candidates for Liar Game episode 8 and Black
Clover 132 in 1080p. Coverage overlaps other providers; this is a backup,
not a promise of additional releases.

StremThru Torz's public P2P lookup also worked, but is not included: its
file-indexed series packs need a verified Hayase file-selection adapter first.
No Torz/debrid credentials are used or stored.

AnimeTosho NEW is a separate successor to the retired original. The original
[AnimeTosho homepage](https://animetosho.org/) links to the successor's old
`.xyz` domain, which redirects to `.net`. Its
[FAQ](https://animetosho.net/about) documents public JSON feeds, tested on
October 16, 2026. It has not been added to these extensions: the inspected
record originated on Nyaa, and the missing result was caused by its short
dub label. The retired extension ID still represents the original service.

Run the offline regression checks with Node.js:

```text
node tests/batch-fallback.mjs
node tests/network-search.mjs
node --test tests/rate-limit.mjs
node --test tests/knaben.mjs
node --test tests/seadex.mjs
node --test tests/search-diagnostics.mjs
```

The offline checks cover Hayase's decoded-URL prefix contract, manifest/code
versions and retired-source behavior. They do not automate the installed
Hayase UI or verify playback.
