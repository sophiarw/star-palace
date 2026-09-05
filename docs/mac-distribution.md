# Mac distribution investigation

Status: September 5, 2026. Runtime foundation checked on Apple silicon, macOS, Node 22.17. No signed app or downloadable installer has been released.

## Intended experience

Download Star Palace, drag it into Applications, and open it. Choose a folder with the native folder picker. The app manages its own local service; no Git, Terminal, Node installation, or development server is required. Filename/text search and browsing work without an embedding model. Explain Ollama as an optional way to add meaning-based search, not a mandatory first-launch obstacle.

Existing libraries must be detected and backed up before adoption. Do not silently run a new release's migrations against the only copy of a user's library.

## Recommendation

Package the existing renderer and daemon in a small Electron shell for the first Mac release. This preserves the Chromium Canvas/WebGL behavior already checked in the app. Use a sandboxed window with Node integration disabled, context isolation enabled, and a narrow preload bridge for actions such as choosing a folder. Run the compiled daemon in a supervised utility process. The main process owns startup, failure messages, single-instance behavior, and shutdown.

Electron carries a larger runtime download than a native WebKit shell. A Swift/WebKit wrapper is an option for a later size-focused experiment, but would introduce a second browser engine to validate and still need a bundled Node service. A full native rewrite is not justified for distribution alone.

Sources: [Electron distribution](https://www.electronjs.org/docs/latest/tutorial/distribution-overview), [utility processes](https://www.electronjs.org/docs/latest/api/utility-process), [security guidance](https://www.electronjs.org/docs/latest/tutorial/security), [macOS packaging](https://www.electron.build/v26/docs/mac/). Registry versions observed during this investigation: Electron 44.2.0 and electron-builder 26.15.3. These are observations, not newly installed dependencies or a permanent version recommendation.

## Work completed now

- `npm start` supervises the source daemon and renderer in one terminal; `npm run start:demo` uses the fictional library.
- `npm run build:daemon` emits plain CommonJS JavaScript and both worker files into `dist-daemon`.
- The PCA worker uses emitted JavaScript when available, while the development path keeps its existing TypeScript loader.
- `node scripts/check-mac-runtime.mjs` verifies compiled text extraction, compiled PCA, compiled daemon startup/SQLite access, source launcher startup, and both servers stopping when the launcher exits. It creates and removes temporary fixture databases. The primary library is never opened.

This proves that the application service can run without the TypeScript development loader. It does not prove an Electron build, Electron-native module compatibility, or a clean-machine install.

## Remaining work for a real download

1. **Native dependencies.** Build `better-sqlite3` and `hnswlib-node` for the chosen Electron ABI, in a separate packaging directory. Never rebuild the developer checkout's modules in place. Unpack native binaries and any required worker resources from the application archive.
2. **Local connection.** Replace baked-in port assumptions with a per-launch endpoint. Authenticate requests with a per-launch secret and restrict origins/hosts. Bind only to loopback. Avoid attaching to a different running development daemon. Preserve PDF/image reading without exposing an unauthenticated local file API.
3. **Lifecycle and onboarding.** Native folder selection, a useful empty state, optional Ollama status/setup, existing-library backup/adoption, startup errors, service supervision, and graceful shutdown during indexing.
4. **Mac builds.** Produce separate Apple silicon and Intel artifacts on their corresponding Mac runners first. A universal app can follow once both native dependency sets and their tests pass.
5. **Signing.** Sign the app and nested binaries with a Developer ID Application identity, enable the required hardened-runtime settings, notarize, and staple the ticket. This needs the owner's Apple Developer credentials. Do not publish an unsigned build as the ordinary install path or tell people to disable Gatekeeper.
6. **Release and maintenance.** Include LICENSE and third-party notices; create checksums and a GitHub release; link the site to actual release assets only after validation. Keep update manifests signed and plan a reversible library upgrade path.
7. **Clean-machine acceptance.** A Mac with no Node/Git/Ollama can open the app, choose a folder, index and search, preview common formats, reopen its library, and quit without leftover processes. Repeat on both supported CPU architectures.

Signing background: [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing). The website intentionally continues to show working source installation instructions until a downloadable app exists.
