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

Run the offline regression checks with Node.js:

```text
node tests/batch-fallback.mjs
node tests/network-search.mjs
node --test tests/rate-limit.mjs
```
