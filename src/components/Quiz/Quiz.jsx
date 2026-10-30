// Quiz.jsx
import { useState, useEffect } from 'react';
import './Quiz.css';

function formatTime(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || totalSeconds === '') return '00:00';
  const sec = typeof totalSeconds === 'number' ? totalSeconds : parseInt(totalSeconds, 10);
  if (isNaN(sec)) return '00:00';
  const mins = Math.floor(sec / 60);
  const remainingSecs = sec % 60;
  return `${String(mins).padStart(2, '0')}:${String(remainingSecs).padStart(2, '0')}`;
}

export default function Quiz({ sessionId, timer, violationCount = 0, restoredAnswers, onFinish }) {
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState(restoredAnswers || {});
  const [reviewed, setReviewed] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);

  // Fetch questions
  useEffect(() => {
    fetch('http://localhost:3000/exam/mcq')
      .then(res => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then(data => setQuestions(data))
      .catch(err => console.error("Failed to fetch questions:", err));
  }, []);

  async function handleAnswerSelect(questionId, selectedAnswerIndex) {
    const previousAnswer = answers[questionId];
    
    // Optimistic update
    setAnswers(prev => ({ ...prev, [questionId]: selectedAnswerIndex }));

    try {
      const res = await fetch('http://localhost:3000/exam/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          questionId: questionId,
          selectedAnswer: selectedAnswerIndex
        })
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Failed to submit answer:", data.message);
        alert(data.message);
        // Revert on API error
        setAnswers(prev => {
          const newAnswers = { ...prev };
          if (previousAnswer === undefined) {
            delete newAnswers[questionId];
          } else {
            newAnswers[questionId] = previousAnswer;
          }
          return newAnswers;
        });
      }
    } catch (err) {
      console.error("Network error submitting answer:", err);
      setAnswers(prev => {
        const newAnswers = { ...prev };
        if (previousAnswer === undefined) {
          delete newAnswers[questionId];
        } else {
          newAnswers[questionId] = previousAnswer;
        }
        return newAnswers;
      });
    }
  }

  function handleClearSelection(questionId) {
    setAnswers(prev => {
      const newAnswers = { ...prev };
      delete newAnswers[questionId];
      return newAnswers;
    });
  }

  function toggleMarkForReview(questionId) {
    setReviewed(prev => ({
      ...prev,
      [questionId]: !prev[questionId]
    }));
  }

  async function submitExamOnBackend() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('http://localhost:3000/exam/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      const data = await res.json();
      if (res.ok) {
        onFinish(data.result);
      } else {
        alert("Failed to submit exam: " + data.message);
        setIsSubmitting(false);
      }
    } catch (err) {
      console.error("Failed to submit exam:", err);
      setIsSubmitting(false);
    }
  }

  if (questions.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: '#ffffff' }}>
        <p style={{ color: '#64748b', fontSize: '15px', fontWeight: '500' }}>Loading quiz questions...</p>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const selectedOptIndex = answers[currentQuestion.id];
  const isMarkedForReview = !!reviewed[currentQuestion.id];

  const totalAnswered = Object.keys(answers).length;
  const totalReviewed = Object.values(reviewed).filter(Boolean).length;
  const totalQuestions = questions.length;

  return (
    <div className="quiz-page">
      {/* Top Header */}
      <header className="quiz-header">
        <div className="quiz-title">
          Gated Architectures, LSTM, GRU - Revision
        </div>

        <div className="quiz-header-right">
          {violationCount > 0 && (
            <div className="quiz-warning-badge">
              Warnings: {violationCount}
            </div>
          )}

          <div className="quiz-timer-badge">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>{formatTime(timer)}</span>
          </div>

          <button
            className="submit-quiz-btn"
            onClick={() => setShowConfirmSubmit(true)}
            disabled={isSubmitting}
          >
            Submit Quiz
          </button>
        </div>
      </header>

      {/* Main Question Area */}
      <main className="quiz-body">
        {/* Sub-bar above Question */}
        <div className="question-subbar">
          <div className="question-counter">
            QUESTION {currentIndex + 1}/{totalQuestions}
          </div>

          <div className="question-actions">
            <button
              className={`btn-review ${isMarkedForReview ? 'active' : ''}`}
              onClick={() => toggleMarkForReview(currentQuestion.id)}
            >
              {isMarkedForReview ? 'Marked for review ✓' : 'Mark for review'}
            </button>

            <button
              className="btn-clear"
              disabled={selectedOptIndex === undefined}
              onClick={() => handleClearSelection(currentQuestion.id)}
            >
              Clear Selection
            </button>

            <button className="btn-feedback" title="Report issue" onClick={() => alert("Report Question feedback logged.")}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m8 2 1.88 1.88"></path>
                <path d="M14.12 3.88 16 2"></path>
                <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"></path>
                <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"></path>
                <path d="M12 20v-9"></path>
                <path d="M6.53 9C4.6 8.8 3 7.1 3 5"></path>
                <path d="M6 13H2"></path>
                <path d="M3 21c0-2.1 1.7-3.9 3.8-4"></path>
                <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"></path>
                <path d="M22 13h-4"></path>
                <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"></path>
              </svg>
            </button>
          </div>
        </div>

        {/* Question Heading */}
        <h2 className="question-title">
          {currentQuestion.question}
        </h2>

        {/* Vertical Options List */}
        <div className="options-stack">
          {currentQuestion.options.map((optionText, optIdx) => {
            const isSelected = selectedOptIndex === optIdx;
            const letter = String.fromCharCode(65 + optIdx); // A, B, C, D

            return (
              <div
                key={optIdx}
                className={`option-card ${isSelected ? 'selected' : ''}`}
                onClick={() => handleAnswerSelect(currentQuestion.id, optIdx)}
              >
                <span className="option-letter">{letter}</span>
                <span className="option-text">{optionText}</span>
              </div>
            );
          })}
        </div>
      </main>

      {/* Question Palette Drawer / Popover */}
      {showPalette && (
        <div className="palette-popover">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>Questions Palette</span>
            <button
              style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94a3b8' }}
              onClick={() => setShowPalette(false)}
            >
              ×
            </button>
          </div>
          <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#64748b', marginBottom: '10px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }}></span> Answered
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#6366f1' }}></span> Review
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#e2e8f0' }}></span> Unvisited
            </span>
          </div>
          <div className="palette-grid">
            {questions.map((q, idx) => {
              const isAnswered = answers[q.id] !== undefined;
              const isRev = !!reviewed[q.id];
              const isCurr = idx === currentIndex;

              let itemClass = 'palette-item';
              if (isRev) itemClass += ' reviewed';
              else if (isAnswered) itemClass += ' answered';
              if (isCurr) itemClass += ' current';

              return (
                <div
                  key={q.id}
                  className={itemClass}
                  onClick={() => {
                    setCurrentIndex(idx);
                    setShowPalette(false);
                  }}
                >
                  {idx + 1}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom Sticky Navigation Bar */}
      <footer className="quiz-bottom-bar">
        {/* Previous Button */}
        <button
          className="btn-nav-prev"
          disabled={currentIndex === 0}
          onClick={() => setCurrentIndex(c => Math.max(0, c - 1))}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
          <span>Previous</span>
        </button>

        {/* Center Grid Toggle Icon */}
        <button
          className="btn-grid-palette"
          title="Toggle Questions Palette"
          onClick={() => setShowPalette(p => !p)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
            <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
            <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
            <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
          </svg>
        </button>

        {/* Next / Submit Button */}
        {currentIndex < totalQuestions - 1 ? (
          <button
            className="btn-nav-next"
            onClick={() => setCurrentIndex(c => Math.min(totalQuestions - 1, c + 1))}
          >
            <span>Next</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        ) : (
          <button
            className="btn-nav-next"
            style={{ backgroundColor: '#338656' }}
            onClick={() => setShowConfirmSubmit(true)}
          >
            <span>Finish</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </button>
        )}
      </footer>

      {/* Submit Confirmation Modal */}
      {showConfirmSubmit && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            maxWidth: '460px',
            width: '100%',
            padding: '28px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
          }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#0f172a', marginBottom: '12px' }}>
              Submit Exam?
            </h3>
            <p style={{ fontSize: '14px', color: '#64748b', lineHeight: '1.5', marginBottom: '20px' }}>
              Are you sure you want to finish and submit your test? Once submitted, answers cannot be edited.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', textAlign: 'center', marginBottom: '24px' }}>
              <div style={{ background: '#f0fdf4', padding: '10px', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
                <div style={{ fontSize: '18px', fontWeight: '700', color: '#16a34a' }}>{totalAnswered}</div>
                <div style={{ fontSize: '11px', color: '#166534', fontWeight: '600' }}>Answered</div>
              </div>
              <div style={{ background: '#eef2ff', padding: '10px', borderRadius: '8px', border: '1px solid #c7d2fe' }}>
                <div style={{ fontSize: '18px', fontWeight: '700', color: '#4f46e5' }}>{totalReviewed}</div>
                <div style={{ fontSize: '11px', color: '#4338ca', fontWeight: '600' }}>For Review</div>
              </div>
              <div style={{ background: '#f8fafc', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '18px', fontWeight: '700', color: '#64748b' }}>{totalQuestions - totalAnswered}</div>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600' }}>Left</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                className="btn btn-outline"
                onClick={() => setShowConfirmSubmit(false)}
                disabled={isSubmitting}
              >
                Continue Test
              </button>
              <button
                className="btn"
                style={{ backgroundColor: '#338656', color: '#ffffff' }}
                onClick={submitExamOnBackend}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Submitting...' : 'Yes, Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
