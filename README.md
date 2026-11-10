# Athena Desktop Exam Client

Athena is an Electron and React exam client. Grading is performed by the API in
`backend/`; production desktop packages never contain that service or its answer
key.

## Local development

Install dependencies, start Vite, and then start Electron in another terminal:

```bash
npm install
npm run dev
```

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

The Electron Builder file list is an allowlist containing only `app/app.js`,
`app/preload.js`, the compiled UI, and package metadata. `backend/`, grading
files, and session records are not copied into desktop artifacts.
