# Star Palace website

A static, responsive site for starpalace.ai. Source lives separately from the app, but imports its canonical stellar palette, byte-size curve, and Canvas artwork. It contains only fictional example files. No analytics, third-party fonts, uploaded library data, or self-hosted feedback server.

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

Email feedback is prepared using FormSubmit's opaque form ID. Until the recipient verifies delivery and `FEEDBACK_FORM_ID` is set in `website/feedback.config.ts`, the site retains its existing public GitHub draft handoff. Do not claim email delivery is active while this value is empty.

### Private recipient setup

1. Obtain approval to share the intended recipient address with FormSubmit for delivery. Request its activation email privately; never put the recipient in public HTML, JavaScript, configuration, issues, or committed setup scripts.
2. The recipient activates delivery from their inbox and supplies only the public random form ID supplied by FormSubmit. Do not request or commit their activation link, archive API key, password, or email address.
3. Put that opaque ID in `website/feedback.config.ts`, build/test, and publish. The configuration rejects email addresses and URLs. The form ID is public routing information, not a secret.
4. Send one clearly identified test submission and have the recipient confirm receipt before calling delivery verified. Automated tests intercept all provider requests.

With an ID configured, the build emits a native POST form that also works without JavaScript. The enhanced form submits in place, prevents duplicate clicks, retains drafts on failures/timeouts, and clears only after provider acceptance. A provider acknowledgment does not prove inbox delivery. Reply email is optional; no attachments are accepted. The native flow retains provider CAPTCHA defaults; a honeypot is also present. The copy identifies FormSubmit and its documented 30-day submission retention. Feedback is delivered to the recipient rather than published as a GitHub issue; it is still processed by the external provider and email services.

Provider documentation checked September 6, 2026: [opaque form IDs and retention](https://formsubmit.co/documentation), [AJAX submission](https://formsubmit.co/ajax-documentation), [privacy policy](https://formsubmit.co/privacy.pdf).

## Publishing

`.github/workflows/website.yml` builds, checks, and publishes the site from `main`. It uploads only `dist-site`, not the daemon or the user's library. GitHub Pages must be enabled once by a repository administrator.

1. Open [repository Pages settings](https://github.com/sophiarw/star-palace/settings/pages).
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. In **Custom domain**, enter **starpalace.ai** and save, before changing DNS.
4. If the `github-pages` environment restricts deployment branches, allow `main`. The workflow publishes only from that branch.
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

Use the user's wording: “A memory palace for constellations of files.” Keep the stargazing/SharePoint description. Use sentence case for headings, buttons, and labels. Preserve proper names (Star Palace, Mac, GitHub, SharePoint), acronyms (PDF, CSV), and byte-unit casing (KiB, MiB, GiB). Prefer nouns or questions for headings. Avoid repeating the same product explanation in multiple cards; use the celestial artwork in its place.

## Stellar identity

`public/palace-calligraphy.svg` is an editable brush silhouette of 宫 with pale blue, ivory, gold, and soft red color, a few bright cores, and a restrained aura. The favicon uses its simpler ivory silhouette. These replace the rejected constellation-dot logo.

`public/palace-stellar-calligraphy.jpg` is an unchanged copy of the user's revised Gemini reference, preserved in `docs/design/palace-stellar-calligraphy-reference.jpg`. It appears once as decorative hero background shading at **0.10 opacity**, following the user's explicit instruction not to feature AI art front and center. CSS handles desaturation and placement; the source image is not modified. The near-black page background is `#030507`.

## Graphics and changes

`website/src/main.ts` draws the illustrative galaxy only on interaction or resize; no animation loop. `stellarVisual.ts` and `drawStellarObject` in `celestialSprites.ts` supply the same pale starlight, size curve, and object artwork as the app. Ten example files remain ordinary stars, while two explicit favorites have pulsar/black-hole silhouettes. Byte sizes alter ordinary stars' presence; file extensions do not assign exotic object types. Faint blue, rose, and amber clouds follow three authored fictional groups. Connections follow the selected file's direct folder. This illustrative data does not run the app's similarity algorithm.

`website/src/demo.ts` owns fictional content and search matching. `website/index.html` owns the user's product copy, installation instructions, and accessible form. Keep the user's exact main headings and stargazing/SharePoint wording.

To regenerate the share card while the local site runs:

```sh
node scripts/generate-site-social.mjs
```

The 1200×630 `public/social.png` uses the vector mark, fictional app artwork, and the same 0.10-opacity reference background. No external fonts or image hosts are required.

## Validation

Browser checks cover stationary search highlights, previews, keyboard tutorial controls, escaped feedback handoff, clipboard contents, disabled JavaScript, responsive layouts at 320/390/768/1440 pixels, restrained background opacity, and ordinary-star/favorite semantics. Desktop/mobile screenshots were also inspected locally. The browser tests intercept GitHub navigation and every FormSubmit request; they never submit real feedback. Email tests cover validation, duplicate clicks, provider/network failures, draft retention, optional reply email, opaque configuration, and native POST without JavaScript.

The original hero background is approximately 699 KiB and loads once. The share card is for social crawlers; it is not loaded by the page. Run `npm run build:site` for current bundle sizes.

## License

See [LICENSE](../LICENSE): PolyForm Noncommercial 1.0.0 with an additional permission for personal and internal workplace use. It permits using Star Palace in paid work, but not selling or monetizing Star Palace itself. This is source-available software, not an OSI open-source license. Third-party dependencies retain their own licenses.

## First installation

The public instructions use a normal HTTPS clone of the repository. Its default branch, `main`, contains the current application. They place the checkout at `~/star-palace`, install locked dependencies with `npm ci`, and launch both local processes with `npm start`. Prerequisites are Node.js 22 and Apple command line tools (including Git); the visitor finishes those installations before copying the app commands. The tutorial explains copying a folder path from Finder and using Library → Manage sources → Index folder. A separate Next launch section makes returning to the app explicit. This remains a source installation; no downloadable Mac app is advertised as available.
