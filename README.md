# Athena Desktop Exam Client

Athena is an Electron and React exam client. Grading is performed by the API in
`backend/`; production desktop packages never contain that service or its answer
key.

## Local development

To launch from a clean checkout:

```bash
npm install
npm start
```

`npm start` builds the UI before launching Electron. If the Vite dev server is
unavailable, Electron loads the complete build from `dist/`. A failed build stops
startup.

For live UI updates, start Vite first:

```bash
npm run dev
```

Then launch Electron in another terminal:

```bash
npm start
```

When Electron is not packaged and no remote API is configured, it starts the
development backend on `127.0.0.1:3000` with a random per-launch API token.

## Production deployment

Deploy `backend/` on infrastructure controlled by the exam administrator. Keep
the production answer key on that server and point `ANSWER_KEY_PATH` at it. Put
the service behind HTTPS and configure a token of at least 32 characters:

```bash
API_TOKEN="replace-with-a-long-random-token" \
ANSWER_KEY_PATH="/run/secrets/athena-answer-key.json" \
npm --prefix backend start
```

Build the desktop application with `npm run build`. At launch, provision the
remote endpoint and matching API credential in the application environment:

```bash
ATHENA_API_BASE_URL="https://exam-api.example.edu" \
ATHENA_API_TOKEN="replace-with-a-long-random-token" \
./Athena
```

Packaged builds intentionally fail closed when these settings are absent, when
the endpoint is local, or when it does not use HTTPS. The credential controls
API access; it is not a substitute for candidate authentication and should be
provisioned by the administrator rather than committed to the desktop source.

The Electron Builder file list is an allowlist containing only the Electron
entry point, preload and snapshot modules, the compiled UI, and package metadata.
`backend/`, grading files, and session records are not copied into desktop artifacts.

## Proctoring snapshot storage

Snapshots are bounded JPEGs (at most 1280 × 720, 75% quality and 2 MiB per image).
Each active exam requests camera and desktop captures every five seconds; each
source has its own in-flight guard, and slow operations are skipped rather than
queued without limit. Filesystem work is asynchronous. A stalled operation keeps
its slot occupied even after a 15-second timeout so retries cannot accumulate.
Capture failures and delays appear as a non-blocking warning during the exam.

The selected folder contains an app-owned `athena-snapshots/` directory with
`<sessionId>/camera/` and `<sessionId>/screen/` subdirectories. The fallback is
`athena-snapshots/` in Electron's user-data directory, not the application install.
The rolling retention policy keeps at most 512 MiB and 5,000 images across all
sessions in that store, deleting the oldest images first; images older than seven
days and abandoned partial writes are also removed on capture. Writes stop if
they would leave less than 256 MiB of free space. These limits are defined in
`app/snapshot-policy.js`.

Cleanup requires an Athena ownership marker and only removes Athena-named image
files and empty session directories. Unrelated files, symbolic links, and legacy
`user-camera-snap` / `user-screen-snap` folders are not automatically deleted.
Archive required evidence outside the managed store before its rolling limits
are reached. Run snapshot regression tests with `npm test`.
