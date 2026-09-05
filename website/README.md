# Star Palace website

A static, responsive site for starpalace.ai. Source lives separately from the app, but imports its Canvas celestial artwork. It contains only fictional example files. No analytics, third-party fonts, uploaded library data, or feedback server.

## Local preview

From the repository root:

```sh
npm ci
npm run dev:site
# http://127.0.0.1:5180
npm run test:site
npm run build:site
```

The production output is `dist-site/`. The site does not run or contact the local file daemon. JavaScript enhances the search illustration, accessible tutorial tabs, copy buttons, and feedback handoff. The explanatory copy and install instructions are static HTML.

The feedback form opens an encoded draft at `sophiarw/star-palace/issues/new`. The visitor needs a GitHub account and reviews/submits there. It does not silently create an issue, collect an email address, or send the draft to a separate service. A future private intake needs a backend/provider and an explicit privacy/retention policy.

## Publishing

`.github/workflows/website.yml` builds, checks, and publishes the site from `feat/atlas-revamp` (and from `main` after the revamp is merged). It uploads only `dist-site`, not the daemon or the user's library. GitHub Pages must be enabled once by a repository administrator.

1. Open [repository Pages settings](https://github.com/sophiarw/star-palace/settings/pages).
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. In **Custom domain**, enter **starpalace.ai** and save, before changing DNS.
4. If the `github-pages` environment restricts deployment branches, allow `feat/atlas-revamp`. The workflow runs from that branch until it is merged.
5. Let the Publish website workflow finish. If a deployment attempted before Pages was enabled, rerun its failed job in [Actions](https://github.com/sophiarw/star-palace/actions).

In Squarespace, open **Domains → starpalace.ai → DNS → DNS Settings**. Replace conflicting website/parking records for `@` and `www` with:

| Host | Type | Value |
| --- | --- | --- |
| @ | A | 185.199.108.153 |
| @ | A | 185.199.109.153 |
| @ | A | 185.199.110.153 |
| @ | A | 185.199.111.153 |
| www | CNAME | sophiarw.github.io |

Keep email records (MX, SPF, DKIM, DMARC), other subdomains, and domain-verification records. Remove conflicting old A/AAAA/ALIAS records for the website hosts rather than leaving them alongside GitHub's records. Squarespace's default TTL is fine. Enable **Enforce HTTPS** in GitHub Pages when the certificate is ready. DNS and certificate provisioning may take up to 24 hours.

GitHub recommends verifying domain ownership in account **Settings → Pages** with its generated TXT record. That value is account-specific and must be copied from GitHub, not guessed.

Sources checked September 5, 2026: [GitHub custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site), [publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site), [Squarespace DNS records for web hosting](https://support.squarespace.com/hc/en-us/articles/31119879125645-DNS-records-for-web-hosting).

## Copy direction

Use the user's wording: “A memory palace for constellations of files.” Keep the stargazing/Sharepoint description. Prefer nouns or questions for headings. Avoid repeating the same product explanation in multiple cards; use the celestial artwork in its place.

## Logo

`public/palace-constellation.svg` forms 宫 (palace) from slightly irregular stars with pale connecting lines and blue, gold, and violet glows. The roof and two 口 shapes stay distinct. The favicon uses the same arrangement with stronger lines for small sizes. Use this mark instead of the earlier compass/starburst.

## Graphics and changes

`website/src/main.ts` draws the illustrative galaxy only on interaction or resize; no animation loop. The object family uses `celestialSprites.ts`, so changes to app artwork flow into the website. `website/src/demo.ts` owns fictional content and search matching. `website/index.html` owns product/install copy.

To regenerate the share card while the local site runs:

```sh
node scripts/generate-site-social.mjs
```

The 1200×630 `public/social.png` is generated from code and the app's existing artwork. No external image assets or fonts are required.

## Validation

Six browser checks cover stationary search highlights, previews, keyboard tutorial controls, escaped feedback handoff, clipboard contents, disabled JavaScript, and responsive layouts at 320/390/768/1440 pixels. Desktop/mobile screenshots were also inspected locally. The browser tests intercept GitHub navigation and never submit feedback.

Production output after copy/logo review: HTML approximately 13.5 KB, CSS 20.4 KB, JavaScript 14.3 KB before compression (roughly 4.5/5.2/6 KB gzip); social artwork is fetched by social crawlers rather than loaded by the page.

## License

See [LICENSE](../LICENSE): PolyForm Noncommercial 1.0.0 with an additional permission for personal and internal workplace use. It permits using Star Palace in paid work, but not selling or monetizing Star Palace itself. This is source-available software, not an OSI open-source license. Third-party dependencies retain their own licenses.
