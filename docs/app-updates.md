# Application updates

Start with `npm start`, then choose **Settings → Application update → Update Star Palace**. The in-app tutorial illustrates the control. Older installations need one manual `git pull --ff-only` and restart to acquire this button.

The update button requires a clean `main` checkout and the official `sophiarw/star-palace` origin. Development branches, divergent histories, and local tracked/untracked changes are reported without replacing them. Finish indexing first. The first release's updater is for source installations on Mac, not a packaged installer.

## Update lifecycle

1. The daemon accepts a local JSON request and refuses new mutation jobs during the update. The launcher starts the updater helper over IPC.
2. Preflight checks the branch, remote, working tree, and ancestry of the fetched `main`. An already-current release finishes without restarting.
3. The launcher stops its daemon and renderer, then the helper rechecks the checkout and fast-forwards to the fetched revision.
4. When dependency manifests changed, the helper preserves the old `node_modules` in `.starpalace-update-backup/`, then runs `npm ci`. It builds both renderer and daemon.
5. Success removes the backup and the launcher restarts the app. The app polls and reloads after reconnection, even if Settings was closed during the update. Terminal output remains available throughout.

If installation/build validation fails and the checkout still matches the update target without local edits, the helper restores the prior revision with `git reset --keep` and restores the saved dependency directory. This recovery does not need a second network install. If someone changes the checkout during the update, it preserves those edits and reports the need for manual review.

An interrupted update can leave `.starpalace-update-backup/`, containing `revision.json` and possibly the previous dependencies. A subsequent update refuses to overwrite that recovery directory. Review its saved revisions and the current checkout before removing it. If the app cannot restart, the terminal carries the error; after resolving the interrupted checkout, run `npm install` and `npm start`. Database and text-history directories are never reset by the updater. Abrupt power-loss recovery is not guaranteed to be automatic.

## Code and validation

- `scripts/start-local.mjs`: child-process lifecycle and IPC status; stops the updater process group on shutdown.
- `scripts/update-local.ts`: preflight/install orchestration outside the daemon that will be restarted.
- `src/daemon/util/sourceUpdate.ts`: release checks, literal-argument Git/npm execution, build validation, dependency backup, and guarded recovery.
- `src/daemon/util/updateRoutes.ts`: local update status/request endpoint.
- `src/renderer/src/atlas/UpdatePanel.tsx`: progress, actionable errors, and reconnect behavior.

Regression tests exercise branch/remote/dirty/divergence refusals and successful/failed installations in disposable Git repositories. Installation tests use fixture dependencies and a simulated build failure; they do not update the user's checkout or install a remote release automatically.

Subprocesses strip inherited Git repository, common-directory, worktree, index, object-directory, namespace, and configuration-routing variables. This is essential when validation runs inside a Git hook; every disposable-repository test verifies its top-level before mutations.
