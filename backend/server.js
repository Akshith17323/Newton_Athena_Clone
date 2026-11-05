const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";

app.use(cors());
app.use(express.json());

const questionsPath = path.join(__dirname, "data", "questions.json");
const answerKeyPath = process.env.ANSWER_KEY_PATH || path.join(__dirname, "..", "app", "grading", "answer-key.json");
const sessionsPath = process.env.SESSIONS_PATH || path.join(__dirname, "data", "sessions.json");

function readQuestions() {
  const questions = JSON.parse(fs.readFileSync(questionsPath, "utf-8"));
  const answerKey = JSON.parse(fs.readFileSync(answerKeyPath, "utf-8"));

  return questions.map((question) => ({
    ...question,
    correctAnswer: answerKey[String(question.id)],
  }));
}

function readSessions() {
  if (!fs.existsSync(sessionsPath)) return [];
  return JSON.parse(fs.readFileSync(sessionsPath, "utf-8"));
}

function saveSessions(sessions) {
  fs.writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2));
}

function makeSessionId() {
  return `session-${Date.now()}`;
}

function questionForStudent(question) {
  return {
    id: question.id,
    question: question.question,
    options: question.options,
  };
}

function sessionForStudent(session) {
  const studentSession = {
    sessionId: session.sessionId,
    userId: session.userId,
    name: session.name,
    startedAt: session.startedAt,
    submittedAt: session.submittedAt,
    status: session.status,
    attempted: session.attempted,
    answers: session.answers.map((answer) => ({
      questionId: answer.questionId,
      selectedAnswer: answer.selectedAnswer,
      answeredAt: answer.answeredAt,
    })),
  };

  if (session.status === "submitted") {
    studentSession.correct = session.correct;
    studentSession.wrong = session.wrong;
  }

  return studentSession;
}

function refreshSessionStats(session) {
  session.attempted = session.answers.length;
  session.correct = session.answers.filter((answer) => answer.isCorrect).length;
  session.wrong = session.attempted - session.correct;
}

function parseQuestionId(value) {
  const questionId = Number(value);
  return Number.isInteger(questionId) ? questionId : null;
}

function validateSelectedAnswer(selectedAnswer, question) {
  return Number.isInteger(selectedAnswer)
    && selectedAnswer >= 0
    && selectedAnswer < question.options.length;
}

app.get("/", (req, res) => {
  res.json({ message: "Exam backend is running" });
});

// Start a new exam session
app.post("/exam/start", (req, res) => {
  const { userId, name } = req.body;

  if (!userId || !name) {
    return res.status(400).json({
      message: "userId and name are required",
    });
  }

  const sessions = readSessions();

  const session = {
    sessionId: makeSessionId(),
    userId,
    name,
    startedAt: new Date().toISOString(),
    submittedAt: null,
    status: "in-progress",
    attempted: 0,
    correct: 0,
    wrong: 0,
    answers: [],
  };

  sessions.push(session);
  saveSessions(sessions);

  res.status(201).json({
    message: "Exam session started",
    sessionId: session.sessionId,
  });
});

// Get one question
app.get("/exam/mcq/:id", (req, res) => {
  const questions = readQuestions();
  const id = Number(req.params.id);

  const question = questions.find((item) => item.id === id);

  if (!question) {
    return res.status(404).json({ message: "Question not found" });
  }

  res.json(questionForStudent(question));
});

// Get all questions without correct answers
app.get("/exam/mcq", (req, res) => {
  const questions = readQuestions();
  res.json(questions.map(questionForStudent));
});

// Save or update one answer
app.post("/exam/answer", (req, res) => {
  const { sessionId, questionId, selectedAnswer } = req.body;

  if (!sessionId || questionId === undefined || selectedAnswer === undefined) {
    return res.status(400).json({
      message: "sessionId, questionId and selectedAnswer are required",
    });
  }

  const parsedQuestionId = parseQuestionId(questionId);

  if (parsedQuestionId === null) {
    return res.status(400).json({ message: "questionId must be an integer" });
  }

  const questions = readQuestions();
  const sessions = readSessions();

  const question = questions.find((item) => item.id === parsedQuestionId);

  if (!question) {
    return res.status(404).json({ message: "Question not found" });
  }

  const session = sessions.find(
    (item) => item.sessionId === sessionId
  );

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  if (session.status !== "in-progress") {
    return res.status(400).json({ message: "Exam is already submitted" });
  }

  if (!validateSelectedAnswer(selectedAnswer, question)) {
    return res.status(400).json({
      message: `selectedAnswer must be an integer between 0 and ${question.options.length - 1}`,
    });
  }

  const isCorrect = selectedAnswer === question.correctAnswer;
  const answeredAt = new Date().toISOString();
  const existingAnswer = session.answers.find(
    (answer) => answer.questionId === parsedQuestionId
  );

  if (existingAnswer) {
    existingAnswer.selectedAnswer = selectedAnswer;
    existingAnswer.isCorrect = isCorrect;
    existingAnswer.answeredAt = answeredAt;
  } else {
    session.answers.push({
      questionId: question.id,
      selectedAnswer,
      isCorrect,
      answeredAt,
    });
  }

  refreshSessionStats(session);
  saveSessions(sessions);

  res.json({
    message: existingAnswer ? "Answer updated" : "Answer saved",
    attempted: session.attempted,
  });
});

// Clear one answer
app.post("/exam/answer/clear", (req, res) => {
  const { sessionId, questionId } = req.body;

  if (!sessionId || questionId === undefined) {
    return res.status(400).json({
      message: "sessionId and questionId are required",
    });
  }

  const parsedQuestionId = parseQuestionId(questionId);

  if (parsedQuestionId === null) {
    return res.status(400).json({ message: "questionId must be an integer" });
  }

  const questions = readQuestions();
  const question = questions.find((item) => item.id === parsedQuestionId);

  if (!question) {
    return res.status(404).json({ message: "Question not found" });
  }

  const sessions = readSessions();
  const session = sessions.find((item) => item.sessionId === sessionId);

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  if (session.status !== "in-progress") {
    return res.status(400).json({ message: "Exam is already submitted" });
  }

  const answerIndex = session.answers.findIndex(
    (answer) => answer.questionId === parsedQuestionId
  );

  if (answerIndex !== -1) {
    session.answers.splice(answerIndex, 1);
  }

  refreshSessionStats(session);
  saveSessions(sessions);

  res.json({
    message: answerIndex === -1 ? "Answer was already clear" : "Answer cleared",
    attempted: session.attempted,
  });
});

// Get current session progress
app.get("/exam/session/:sessionId", (req, res) => {
  const sessions = readSessions();

  const session = sessions.find(
    (item) => item.sessionId === req.params.sessionId
  );

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  res.json(sessionForStudent(session));
});

// Submit the whole exam
app.post("/exam/submit", (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ message: "sessionId is required" });
  }

  const sessions = readSessions();

  const session = sessions.find(
    (item) => item.sessionId === sessionId
  );

  if (!session) {
    return res.status(404).json({ message: "Session not found" });
  }

  session.status = "submitted";
  session.submittedAt = new Date().toISOString();

  saveSessions(sessions);

  res.json({
    message: "Exam submitted successfully",
    result: {
      attempted: session.attempted,
      correct: session.correct,
      wrong: session.wrong,
    },
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Exam backend running at http://${HOST}:${PORT}`);
});
