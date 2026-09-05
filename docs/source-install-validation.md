# Mac source-install validation

Validated September 5, 2026, from an anonymous HTTPS clone of the public `feat/atlas-revamp` branch, with the current release work overlaid before installation. The temporary checkout had no copied `node_modules`, build output, or user library. This verifies the files being prepared for release; the public clone receives those changes only after they are pushed.

## Environment and outcome

- macOS on Apple Silicon (`darwin arm64`), Node 22.17.0, npm 11.4.2, Xcode developer tools available.
- Public `git clone --branch feat/atlas-revamp https://github.com/sophiarw/star-palace.git` succeeded without repository authentication.
- A fresh `npm ci` installed 611 packages in approximately 7 seconds, including the native modules needed by the daemon. The repository prepare hook installed successfully in the normal clone.
- `npm start` launched the daemon and renderer using separate temporary library paths and unused local ports. Those overrides isolate validation; ordinary installation uses the advertised defaults.
- The browser opened a genuinely empty library, clicked **Add your first folder**, submitted a folder path containing spaces, and indexed two new documents.
- A query for a phrase appearing inside a Markdown document found the file; the Reader displayed the extracted text. There were no browser page errors.
- Control C stopped both local servers.

The check passed twice: with the existing optional Ollama service (two embedded files), and with `STARPALACE_OLLAMA_URL` pointing to an unused loopback port (Ollama unavailable, zero embedded files). Folder indexing, extracted-text search, and reader preview worked in both cases. The unavailable-service run did not stop or change the existing Ollama service. No claim is made about an Intel Mac, an otherwise pristine macOS installation without developer tools, Safari, or workplace-managed installation permissions. There is no signed standalone app or drag-to-Applications download yet.

## First-run correction

The clean install caught an onboarding bug hidden by populated demo fixtures: the label canvas intercepted clicks on the visible **Add your first folder** button. The empty-state overlay now sits above the map canvases. `tests/browser/onboarding.spec.ts` verifies a real pointer click opens the source form.

## Repeating the check

After `npm ci`, with Chrome installed for the automated browser check:

```sh
node scripts/check-source-install.mjs
node scripts/check-source-install.mjs --without-model
```

The daemon accepts optional `STARPALACE_OLLAMA_URL` to override its embedding-service endpoint; the ordinary default remains `http://localhost:11434`. The `--without-model` check uses that actual configuration to choose an unused loopback port.

The script launches the actual `npm start` command, creates only temporary fixture files and a temporary database, exercises the first-run UI/search/reader, checks shutdown, and removes its temporary data. Chrome and Playwright are verification tools; the normal app instructions do not require this script or Chrome specifically.

## Dependency audit observation

The locked install succeeded but npm reported 15 advisories at the time of this run: 1 critical, 8 high, 5 moderate, and 1 low. The critical advisory concerns the Vitest UI server, which normal `npm start` does not launch. The high advisories include the Vite development server used by `npm start`, undici, and transitive tooling dependencies. This is an observation of the tested lockfile, not a clean-security-audit claim. Dependency upgrades need their own compatibility checks; no blanket `npm audit fix --force` was applied as part of installation validation.
