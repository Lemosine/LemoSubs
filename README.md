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
pending single/batch requests and searches up to three title aliases; network
failures are reported separately from successful searches with no matches.

Run the offline regression checks with Node.js:

```text
node tests/batch-fallback.mjs
node tests/network-search.mjs
```
