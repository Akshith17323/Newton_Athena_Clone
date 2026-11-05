import { useState, useEffect, useRef } from 'react';
import { apiUrl } from '../../api';

function formatTime(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || totalSeconds === '') return '00:00';
  const sec = typeof totalSeconds === 'number' ? totalSeconds : parseInt(totalSeconds, 10);
  if (isNaN(sec)) return '00:00';
  const mins = Math.floor(sec / 60);
  const remainingSecs = sec % 60;
  return `${String(mins).padStart(2, '0')}:${String(remainingSecs).padStart(2, '0')}`;
}

export default function Quiz({ sessionId, studentName, studentId, timer, violationCount = 0, restoredAnswers, onFinish }) {
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState(restoredAnswers || {});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingQuestionIds, setPendingQuestionIds] = useState(() => new Set());
  const pendingQuestionIdsRef = useRef(new Set());
  const isSubmittingRef = useRef(false);

  // Fetch questions
  useEffect(() => {
    fetch(apiUrl('/exam/mcq'))
      .then(res => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then(data => setQuestions(data))
      .catch(err => console.error("Failed to fetch questions:", err));
  }, []);

  function markQuestionPending(questionId, isPending) {
    if (isPending) {
      pendingQuestionIdsRef.current.add(questionId);
    } else {
      pendingQuestionIdsRef.current.delete(questionId);
    }
    setPendingQuestionIds(new Set(pendingQuestionIdsRef.current));
  }

  function restoreAnswer(questionId, previousAnswer) {
    setAnswers(prev => {
      const nextAnswers = { ...prev };
      if (previousAnswer === undefined) {
        delete nextAnswers[questionId];
      } else {
        nextAnswers[questionId] = previousAnswer;
      }
      return nextAnswers;
    });
  }

  async function responseData(response) {
    try {
      return await response.json();
    } catch {
      return { message: `Request failed with status ${response.status}` };
    }
  }

  async function handleAnswerSelect(questionId, selectedAnswerIndex) {
    if (isSubmittingRef.current || pendingQuestionIdsRef.current.has(questionId)) return;

    // Save previous answer to revert in case of failure
    const previousAnswer = answers[questionId];
    markQuestionPending(questionId, true);

    // Optimistically update UI
    setAnswers(prev => ({ ...prev, [questionId]: selectedAnswerIndex }));

    try {
      const res = await fetch(apiUrl('/exam/answer'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          questionId: questionId,
          selectedAnswer: selectedAnswerIndex
        })
      });
      const data = await responseData(res);
      if (!res.ok) {
        console.error("Failed to submit answer:", data.message);
        alert(data.message);
        restoreAnswer(questionId, previousAnswer);
      }
    } catch (err) {
      console.error("Network error submitting answer:", err);
      alert("Could not save the answer. Please check the backend connection and try again.");
      restoreAnswer(questionId, previousAnswer);
    } finally {
      markQuestionPending(questionId, false);
    }
  }

  async function handleClearAnswer(questionId) {
    if (isSubmittingRef.current || pendingQuestionIdsRef.current.has(questionId)) return;

    const previousAnswer = answers[questionId];
    if (previousAnswer === undefined) return;

    markQuestionPending(questionId, true);
    restoreAnswer(questionId, undefined);

    try {
      const res = await fetch(apiUrl('/exam/answer/clear'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, questionId })
      });
      const data = await responseData(res);
      if (!res.ok) {
        console.error("Failed to clear answer:", data.message);
        alert(data.message);
        restoreAnswer(questionId, previousAnswer);
      }
    } catch (err) {
      console.error("Network error clearing answer:", err);
      alert("Could not clear the answer. Please check the backend connection and try again.");
      restoreAnswer(questionId, previousAnswer);
    } finally {
      markQuestionPending(questionId, false);
    }
  }

  async function submitExamOnBackend() {
    if (isSubmittingRef.current) return;
    if (pendingQuestionIdsRef.current.size > 0) {
      alert("Please wait for the current answer to finish saving.");
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const res = await fetch(apiUrl('/exam/submit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      const data = await responseData(res);
      if (res.ok) {
        onFinish(data.result);
      } else {
        alert("Failed to submit exam: " + data.message);
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    } catch (err) {
      console.error("Failed to submit exam:", err);
      alert("Could not submit the exam. Please check the backend connection and try again.");
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  if (questions.length === 0) {
    return <div className="page-container"><p>Loading questions...</p></div>;
  }

  const currentQuestion = questions[currentIndex];
  const selectedOptIndex = answers[currentQuestion.id];
  const currentQuestionPending = pendingQuestionIds.has(currentQuestion.id);

  return (
    <div className="page-container" style={{ display: 'flex', gap: '24px', maxWidth: '1000px', margin: '0 auto', alignItems: 'flex-start' }}>
      
      {/* Sidebar for Question Navigation */}
      <div className="card-container" style={{ width: '250px', padding: '16px' }}>
        <h3 style={{ marginBottom: '16px', fontSize: '18px' }}>Questions</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
          {questions.map((q, idx) => {
            const isAns = answers[q.id] !== undefined;
            const isCurr = idx === currentIndex;
            return (
              <button
                key={q.id}
                onClick={() => setCurrentIndex(idx)}
                style={{
                  padding: '8px',
                  borderRadius: '4px',
                  border: isCurr ? '2px solid #000' : '1px solid #cbd5e1',
                  backgroundColor: isAns ? '#10b981' : '#f8fafc',
                  color: isAns ? '#fff' : '#0f172a',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                {idx + 1}
              </button>
            )
          })}
        </div>
        {(studentName || studentId) && (
          <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #e2e8f0', fontSize: '12px', color: '#64748b' }}>
            <div style={{ fontWeight: '600', color: '#0f172a', marginBottom: '4px' }}>Candidate</div>
            {studentName && <div style={{ wordBreak: 'break-word' }}>{studentName}</div>}
            {studentId && <div style={{ color: '#94a3b8' }}>ID: {studentId}</div>}
          </div>
        )}
      </div>

      {/* Main Question Area */}
      <div className="card-container" style={{ flex: 1, textAlign: 'left', minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid #e2e8f0', paddingBottom: '16px' }}>
          <h2>Question {currentIndex + 1} of {questions.length}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {violationCount > 0 && (
              <div style={{ backgroundColor: '#fef3c7', color: '#b45309', padding: '4px 10px', borderRadius: '6px', fontSize: '13px', fontWeight: '600', border: '1px solid #fde68a' }}>
                Warnings: {violationCount}
              </div>
            )}
            <div style={{ fontWeight: 'bold', color: '#dc2626', fontSize: '18px' }}>Time: {formatTime(timer)}</div>
            <button
              className="btn btn-outline"
              style={{ padding: '6px 14px', fontSize: '13px', color: '#dc2626', borderColor: '#fca5a5' }}
              onClick={() => window.athena?.exitExam(true)}
            >
              Exit Exam
            </button>
          </div>
        </div>
        
        <div style={{ flex: 1 }}>
          <h4 style={{ marginBottom: '20px', fontSize: '18px', color: '#0f172a', lineHeight: '1.5' }}>
            {currentQuestion.question}
          </h4>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {currentQuestion.options.map((opt, optIdx) => {
              const isThisSelected = selectedOptIndex === optIdx;
              
              let bgColor = '#fff';
              let borderColor = '#e2e8f0';
              let textColor = '#334155';
              let cursorStyle = currentQuestionPending || isSubmitting ? 'not-allowed' : 'pointer';

              if (isThisSelected) {
                bgColor = '#eff6ff'; // light blue
                borderColor = '#3b82f6'; // blue
                textColor = '#1e3a8a'; // dark blue
              }

              return (
                <div
                  key={optIdx} 
                  onClick={() => {
                    if (!currentQuestionPending && !isSubmitting) {
                      handleAnswerSelect(currentQuestion.id, optIdx);
                    }
                  }}
                  role="radio"
                  aria-checked={isThisSelected}
                  aria-disabled={currentQuestionPending || isSubmitting}
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    padding: '16px', 
                    border: `2px solid ${borderColor}`, 
                    borderRadius: '8px',
                    backgroundColor: bgColor,
                    color: textColor,
                    cursor: cursorStyle,
                    opacity: currentQuestionPending || isSubmitting ? 0.7 : 1,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ 
                    width: '24px', 
                    height: '24px', 
                    borderRadius: '50%', 
                    border: `2px solid ${isThisSelected ? '#3b82f6' : '#cbd5e1'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: '16px',
                    flexShrink: 0,
                    backgroundColor: isThisSelected ? '#3b82f6' : 'transparent'
                  }}>
                    {isThisSelected && <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#fff' }} />}
                  </div>
                  <span style={{ fontSize: '16px', fontWeight: isThisSelected ? '600' : '400' }}>{opt}</span>
                </div>
              )
            })}
          </div>

          {selectedOptIndex !== undefined && (
            <button
              className="btn btn-outline"
              style={{ marginTop: '16px', color: '#dc2626', borderColor: '#fca5a5' }}
              onClick={() => handleClearAnswer(currentQuestion.id)}
              disabled={currentQuestionPending || isSubmitting}
            >
              {currentQuestionPending ? 'Saving...' : 'Clear Selection'}
            </button>
          )}
        </div>

        {/* Navigation Buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '32px', paddingTop: '20px', borderTop: '1px solid #e2e8f0' }}>
          <button 
            className="btn btn-outline" 
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex(c => Math.max(0, c - 1))}
          >
            Previous
          </button>
          
          {currentIndex < questions.length - 1 ? (
            <button 
              className="btn btn-primary" 
              onClick={() => setCurrentIndex(c => Math.min(questions.length - 1, c + 1))}
            >
              Next
            </button>
          ) : (
            <button 
              className="btn btn-primary" 
              style={{ 
                backgroundColor: isSubmitting || pendingQuestionIds.size > 0 ? '#9ca3af' : '#10b981',
                borderColor: isSubmitting || pendingQuestionIds.size > 0 ? '#9ca3af' : '#10b981',
                cursor: isSubmitting || pendingQuestionIds.size > 0 ? 'not-allowed' : 'pointer'
              }} 
              onClick={submitExamOnBackend}
              disabled={isSubmitting || pendingQuestionIds.size > 0}
            >
              {isSubmitting ? 'Submitting...' : pendingQuestionIds.size > 0 ? 'Saving Answer...' : 'Finish Exam'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
