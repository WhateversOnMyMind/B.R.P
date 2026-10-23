# Hosted control: public site build

Run `npm test` and `npm run build` from the repository root with Node 22 or later. There are no frontend dependencies to install. Backend tests run separately in `cloudflare/`; the root integration suite also exercises the real Worker and its SQLite harness when present.

`tools/build.mjs` copies only explicitly listed public files to `dist/`. It generates `/index.html` from `home.html`, keeps `/home.html`, and preserves `/signup/`, `/checkin/`, `/data/`, and their scripts/assets. `meta.env`, IDE metadata, backend code, provisioning outputs, and arbitrary new files are not publishable. Add new public assets to the explicit list when intentionally needed. Never publish the source folder or repository root.

## Public API configuration

The checked-in `control/config.mjs` has an empty `API_BASE_URL`. This is intentional: the page displays a setup notice and disables sign-in until the backend exists. Set the build environment variable `CONTROL_API_BASE_URL` to the provisioned Worker's public HTTPS origin (or an explicitly routed base path). The build emits that public URL into `dist/control/config.mjs`. It rejects HTTP, local hostnames, embedded credentials, query strings, and fragments. There is no local-device fallback.

This variable is public, not a secret. Never put operator keys, device keys, Cloudflare credentials, or R2 credentials in the frontend, a build URL, or `meta.env`. Provision individual pair-scoped operator keys through the backend tooling. The browser keeps the operator key in memory; refresh/close/sign-out clears it. Configure exact preview/production origins in the Worker CORS allowlist before testing authenticated access.

The Netlify configurations now set the deployed public endpoint `https://blindbalance-control.debutgacc.workers.dev`. Local manual builds still require `CONTROL_API_BASE_URL`; the source `config.mjs` intentionally stays unconfigured.

## Netlify setup and rollout

The inspected September 9, 2025 production build log prepared Git reference `refs/heads/main` at `70ed3dd`, used `B.R.P Website` as both the custom build path and publish path, and had no build steps (with an `/bin/false` ignore command). A separate page summary also mentioned Netlify Drop. The log establishes that deployment's Git source, but neither view confirms current auto-deploy settings. Verify the actual project/repository/branch and effective build settings before publishing; the old raw-source publish path must change to generated `dist`.

Preferred Git build settings: repository root as base (`.`), `node tools/build.mjs` as build command, and `dist` as publish directory. The root `netlify.toml` records those settings. If the existing project is explicitly configured with `B.R.P Website` as its base, the nested compatibility config builds with `node ../tools/build.mjs` and publishes `../dist`. Confirm which config Netlify actually loads; do not assume checking in the root file changes a manual Drop deployment.

For Netlify Drop, first run the build locally with the intended public API URL, then upload only `dist`. Manual Drop does not run a build or inject the environment variable. Keep the previous deploy available for rollback. Provisioning and deployment are separate steps; a passing build does not mean the backend is available or the physical devices have migrated.

Check a preview at `/`, `/home.html`, `/signup/`, `/checkin/`, `/data/`, and `/control/`; confirm navigation and assets on desktop and mobile. Do not submit test registrations to live signup/check-in endpoints. Historical data integration is unchanged and has its own endpoint/schema validation requirements.

## Operator behavior

Freshness uses backend `serverTimeMs` plus elapsed monotonic time and a 10-second threshold. Controls require fresh relevant devices and no pending command. Shared settings require both arms. Reported ON/OFF is independent of commanded PWM and is never a claim of physical vibration. An HTTP command receipt means accepted; only confirmed per-arm results can show applied. Expired/failed shared commands can have partial effects.

Command POSTs are never automatically retried. A transport failure or invalid receipt leaves the outcome unknown and locks controls until a newer backend command record is observed. Inspect device state before reconnecting if no record arrives. Authorization failures clear the in-memory key and private state.

Captures start only without an existing local capture, stop/clear carry the exact current capture ID, and clear requires explicit operator confirmation. Downloads come from the authorized backend endpoint, never a public R2 URL. The browser verifies byte count and SHA-256 before handing the CSV to the browser download manager. Recalibration requires a fresh arm and no capture in progress; keep the arm still.
