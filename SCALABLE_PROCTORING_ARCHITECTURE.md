# Scalable Proctoring Architecture Plan

## Objective

Evolve Athena from a single-device Electron prototype into a platform that can organize and proctor exams for a classroom, college, or multi-campus organization.

The current Electron application should become the candidate client. Authentication, exam configuration, answer keys, grading, session authority, evidence storage, and proctor controls should move to centrally controlled services.

## Target Architecture

```text
Candidate Electron App ─── HTTPS / WebSocket ───┐
                                                │
Admin Web App ──────────── HTTPS ───────────────┤
                                                ▼
Proctor Web App ────────── HTTPS / WebSocket ── API Server
                                                │
                         ┌──────────────────────┼─────────────────────┐
                         ▼                      ▼                     ▼
                    PostgreSQL              Redis/Queue        Object Storage
                 users, exams, answers   realtime events/jobs   snapshots/video
                                                │
                                                ▼
                                         Background Workers
                                     grading, reports, alerts
```

The candidate application must never contain:

- Correct answers or marking rules.
- Administrator or proctor credentials.
- Organization-wide exam data.
- Direct database credentials.
- Authorization logic that can be bypassed locally.

## Recommended Repository Structure

Use a monorepo and begin with a modular monolith rather than many microservices.

```text
athena/
├── apps/
│   ├── candidate-electron/
│   │   ├── main/
│   │   ├── preload/
│   │   └── renderer/
│   ├── admin-web/
│   │   ├── exams/
│   │   ├── organizations/
│   │   ├── users/
│   │   └── reports/
│   └── proctor-web/
│       ├── live-sessions/
│       ├── violations/
│       └── evidence-review/
├── services/
│   ├── api/
│   │   ├── auth/
│   │   ├── organizations/
│   │   ├── exams/
│   │   ├── assignments/
│   │   ├── sessions/
│   │   ├── answers/
│   │   ├── proctoring/
│   │   ├── results/
│   │   └── audit/
│   └── worker/
│       ├── grading/
│       ├── snapshot-processing/
│       ├── report-generation/
│       └── notifications/
├── packages/
│   ├── api-contracts/
│   ├── validation/
│   ├── shared-types/
│   ├── shared-ui/
│   └── configuration/
├── infrastructure/
│   ├── docker/
│   ├── database/
│   ├── deployment/
│   └── monitoring/
└── package.json
```

## Roles and Authorization

Authentication must identify users and their organization, not only an Electron installation.

| Role | Responsibilities |
| --- | --- |
| Platform administrator | Manages organizations and platform configuration |
| Organization administrator | Manages one college or institution |
| Exam organizer | Creates, publishes, and assigns exams |
| Proctor | Monitors assigned sessions and handles violations |
| Candidate | Takes assigned exams |
| Reviewer | Reviews results and evidence without editing exams |

Authorization requirements:

- Every organization-owned record includes `organizationId`.
- Every query is scoped to the authenticated organization.
- Proctors can access only assigned exams or sessions.
- Candidates can access only their own assignments and sessions.
- Access tokens are short-lived and refreshable.
- Administrative and proctor actions are written to immutable audit logs.
- All production traffic uses TLS.

The current per-launch local API token remains useful for the prototype, but it is not a substitute for user authentication and role-based authorization.

## Core Data Model

```text
organizations
├── campuses
├── cohorts/classes
└── memberships

users
└── organization_memberships
    └── role

exams
├── exam_versions
├── questions
├── options
├── marking_rules
└── exam_assignments

exam_sessions
├── answers
├── violations
├── heartbeats
├── evidence
├── proctor_actions
└── results
```

Use PostgreSQL instead of JSON files. Important rules include:

- Published exams use immutable versions.
- Answer keys and grading stay on the server.
- Assignments target a class, cohort, or individual candidate.
- A session belongs to one candidate, assignment, and exam version.
- Submission and grading use database transactions.

## Exam Lifecycle

### Organizer

1. Creates an exam and questions.
2. Configures duration, active dates, and proctoring policy.
3. Assigns the exam to a class, cohort, or selected candidates.
4. Assigns one or more proctors.
5. Publishes an immutable exam version.

### Candidate

1. Signs in through the Electron client.
2. Retrieves assigned exams from the remote API.
3. Completes device and proctoring checks.
4. Requests an exam session and receives a session-scoped token.
5. Receives public question content without answers.
6. Autosaves answers with idempotency keys.
7. Sends heartbeats, violations, and evidence references.
8. Submits or is auto-submitted when server time expires.
9. Receives only the result data permitted by exam policy.

### Proctor

1. Opens the proctor dashboard.
2. Views assigned candidates and connection state.
3. Receives violations in real time.
4. Reviews snapshots or screen evidence.
5. Grants extra time, forgives warnings, or locks a session.
6. Records a reason for every intervention.

## Proctoring Data Flow

Begin with event and snapshot monitoring rather than continuous streaming:

- WebSocket heartbeat every 5–10 seconds.
- Immediate violation events.
- Periodic webcam and desktop snapshots.
- Higher-frequency evidence collection after a violation.
- Presigned direct uploads to S3-compatible object storage.
- Metadata and object keys stored in PostgreSQL.

For example, 1,000 candidates uploading one snapshot every 10 seconds creates approximately 100 uploads per second. Uploads should go directly to object storage instead of passing through the API server.

If live monitoring is required later, use WebRTC with an SFU such as LiveKit, mediasoup, or Janus. Do not send continuous video through Express or ordinary WebSockets.

## Reliability Requirements

- Server-authoritative exam clock.
- Idempotent answer saves and final submission.
- Local encrypted answer queue during network loss.
- Automatic retry with backoff.
- Heartbeat-based connected/disconnected status.
- Server-side session lock and submission state.
- Database transactions around final submission and grading.
- Rate limits per user, session, organization, and IP.
- Audit trails for exam edits and proctor actions.
- Encrypted backups and tested restore procedures.
- Configurable evidence-retention and deletion policies.

## Recommended Technology Baseline

For the first scalable release:

- Candidate Electron app.
- React admin and proctor web applications.
- One TypeScript API service organized into domain modules.
- One background-worker process.
- PostgreSQL.
- Redis for presence, caching, queues, and real-time fan-out.
- S3 or MinIO for evidence.
- WebSockets for session status and violations.
- Docker-based development and deployment.

Do not create independent microservices initially. Split the API only when measured load, ownership, or deployment requirements justify it.

## Migration Plan

### Phase 1 — Monorepo foundation

- Move the current Electron application into `apps/candidate-electron`.
- Introduce shared API contracts and validation packages.
- Reorganize the backend into domain modules.
- Add automated unit, integration, and end-to-end tests.

### Phase 2 — Central database and authentication

- Add PostgreSQL migrations.
- Add users, organizations, memberships, and roles.
- Replace JSON session storage.
- Add short-lived access and refresh tokens or institutional SSO.
- Enforce organization-level authorization.

### Phase 3 — Remote exam delivery and grading

- Move exams, questions, answer keys, and grading rules to PostgreSQL.
- Remove the local grading key from candidate packages.
- Add assignments, publishing, autosave, and server-side grading.

### Phase 4 — Admin application

- Manage organizations, classes, candidates, and proctors.
- Build the exam and question editor.
- Configure schedules, duration, and anti-cheat policies.
- Add assignment and result reporting.

### Phase 5 — Proctor dashboard

- Add WebSocket heartbeats and candidate presence.
- Add violation events and evidence review.
- Add extra-time, forgiveness, lock, unlock, and terminate actions.
- Audit every intervention.

### Phase 6 — Evidence pipeline

- Add object storage and presigned uploads.
- Add retention and deletion policies.
- Add asynchronous thumbnail, classification, and report jobs.

### Phase 7 — Scale and hardening

- Horizontally scale stateless API and WebSocket instances.
- Add Redis-backed real-time fan-out and job queues.
- Add monitoring, tracing, alerting, and capacity dashboards.
- Load-test classroom, campus, and organization concurrency targets.
- Complete security, privacy, and disaster-recovery reviews.

## Branch and Pull Request Strategy

Avoid implementing this plan in one very large branch or pull request. Create one branch per migration phase.

Recommended first implementation branch:

```text
refactor/monorepo-foundation
```

Suggested later branches:

```text
feat/organization-auth-rbac
feat/remote-exam-service
feat/admin-exam-management
feat/proctor-dashboard
feat/evidence-upload-pipeline
chore/production-observability
```

If the pull request contains only this architecture document, use:

```text
docs/scalable-proctoring-architecture
```

An ignored document cannot be included in a normal pull request. Remove it from `.gitignore` before creating a documentation PR, or keep it ignored and use it only as a local implementation guide.
