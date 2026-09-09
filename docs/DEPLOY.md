# Deploying metadata.harrys.monster

Same shape as pdf.harrys.monster: static files, `_headers` for the CSP, Cloudflare Pages with an empty build command and `/` as the output directory. Follow `pdf.harrys.monster/docs/DEPLOY.md` steps 1 to 4 with this repository name and domain.

The CSP here is narrower than pdf's: no `worker-src`, no `blob:` images, no `'unsafe-inline'` styles. Downloads use a `blob:` URL on an `<a download>`, which the CSP does not govern.

The analytics snippet in `index.html` is byte-identical to `analytics.harrys.monster/snippet.html`; its hash is already in `_headers`. If the snippet changes, recompute per `analytics.harrys.monster/SNIPPET.md`.

To check the CSP locally, serve the directory with something that applies `_headers` (python's http.server does not), load the page, and drop a file while watching the console.
