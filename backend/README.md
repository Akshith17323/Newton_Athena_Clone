# Exam Backend

A very small Express backend for the Electron exam application.

It uses JSON files instead of a database so students can understand the complete flow before introducing MongoDB, PostgreSQL, or another database.

## Folder Structure

```text
exam-backend/
├── data/
│   ├── questions.json
│   └── sessions.json
├── package.json
├── server.js
└── README.md

app/
└── grading/
    └── answer-key.json
```

## Setup

```bash
npm install
npm start
```

Server runs at:

```text
http://localhost:3000
```

## API Flow

```text
Student starts exam
        ↓
POST /exam/start
        ↓
Session is created
        ↓
GET /exam/mcq/1
        ↓
Question is returned
        ↓
POST /exam/answer
        ↓
Attempt/correct/wrong are updated
        ↓
POST /exam/answer/clear (optional)
        ↓
An existing selection is removed
        ↓
POST /exam/submit
        ↓
Session is marked submitted
```

## 1. Start Exam

### Request

```http
POST /exam/start
Content-Type: application/json
```

```json
{
  "userId": "student-101",
  "name": "Aditya"
}
```

### Response

```json
{
  "message": "Exam session started",
  "sessionId": "session-550e8400-e29b-41d4-a716-446655440000"
}
```

Save this `sessionId` in the frontend. It is UUID-based and identifies this particular exam attempt.

## 2. Get One Question

```http
GET /exam/mcq/1
```

Example response:

```json
{
  "id": 1,
  "question": "Which Electron process is responsible for creating BrowserWindow?",
  "options": [
    "Renderer Process",
    "Main Process",
    "React Process",
    "Preload Process"
  ]
}
```

The correct answer is deliberately not sent to the frontend.

## 3. Get All Questions

```http
GET /exam/mcq
```

## 4. Submit One Answer

```http
POST /exam/answer
Content-Type: application/json
```

```json
{
  "sessionId": "session-550e8400-e29b-41d4-a716-446655440000",
  "questionId": 1,
  "selectedAnswer": 1
}
```

`selectedAnswer` is the option index:

```text
0 = first option
1 = second option
2 = third option
3 = fourth option
```

Example response:

```json
{
  "message": "Answer saved",
  "attempted": 1
}
```

Submitting another option for the same `sessionId` and `questionId` updates the existing answer. It does not create a second attempt. The `attempted`, `correct`, and `wrong` totals are recalculated after every change.

Correctness and live score totals are deliberately withheld while the exam is in progress. This prevents answer changes from being used to probe for the correct option.

## 5. Clear One Answer

```http
POST /exam/answer/clear
Content-Type: application/json
```

```json
{
  "sessionId": "session-550e8400-e29b-41d4-a716-446655440000",
  "questionId": 1
}
```

Example response:

```json
{
  "message": "Answer cleared",
  "attempted": 0
}
```

The route is idempotent. Clearing an unanswered question returns success without changing the totals.

## 6. Check Session

```http
GET /exam/session/session-550e8400-e29b-41d4-a716-446655440000
```

This returns the current exam progress and selected answers. While a session is in progress, it omits per-answer correctness and the `correct`/`wrong` totals. Final totals become available after submission.

## 7. Submit Exam

```http
POST /exam/submit
Content-Type: application/json
```

```json
{
  "sessionId": "session-550e8400-e29b-41d4-a716-446655440000"
}
```

Example response:

```json
{
  "message": "Exam submitted successfully",
  "result": {
    "attempted": 3,
    "correct": 2,
    "wrong": 1
  }
}
```

## Important Teaching Point

The frontend never receives `correctAnswer` when fetching a question.

The public `questions.json` file contains no correct answers. The backend loads the separate grading key through `ANSWER_KEY_PATH` and checks submitted answers itself.

In packaged local builds, the grading key is stored inside `app.asar` instead of the externally visible `Resources/backend` directory. This is local hardening, not a complete security boundary; production exams should use a separately controlled remote grading service.

That gives students the basic client/server idea:

```text
Frontend             Backend
   │                    │
   │ GET question       │
   ├───────────────────→│
   │                    │ read questions.json
   │ question           │
   │←───────────────────┤
   │                    │
   │ POST answer        │
   ├───────────────────→│
   │                    │ checks correct answer
   │ result             │ updates sessions.json
   │←───────────────────┤
```

## Why JSON Files For Now?

The JSON files are acting as our database.

```text
questions.json          = public question database
app/grading/answer-key  = local grading data
sessions.json           = exam session database
```

Later these can be replaced with a real database without changing the basic API idea.
