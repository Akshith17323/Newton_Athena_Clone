import { useState, useEffect } from 'react';

export default function Quiz({ sessionId, timer, restoredAnswers, onFinish }) {
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState(restoredAnswers || {});

  // Fetch questions
  useEffect(() => {
    fetch('/exam/mcq')
      .then(res => res.json())
      .then(data => setQuestions(data))
      .catch(err => console.error("Failed to fetch questions:", err));
  }, []);

  async function handleAnswerSelect(questionId, selectedAnswerIndex) {
    if (answers[questionId] !== undefined) return; // Prevent changing answer
    
    // Optimistically update UI
    setAnswers(prev => ({ ...prev, [questionId]: selectedAnswerIndex }));

    try {
      const res = await fetch('/exam/answer', {
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
      }
    } catch (err) {
      console.error("Network error submitting answer:", err);
    }
  }

  async function submitExamOnBackend() {
    try {
      const res = await fetch('/exam/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      const data = await res.json();
      if (res.ok) {
        onFinish(data.result);
      } else {
        alert("Failed to submit exam: " + data.message);
      }
    } catch (err) {
      console.error("Failed to submit exam:", err);
    }
  }

  return (
    <div className="page-container">
      <div className="card-container" style={{ textAlign: 'left' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2>Exam Questions</h2>
          <div style={{ fontWeight: 'bold', color: '#dc2626' }}>Time: {timer} s</div>
        </div>
        
        {questions.length === 0 ? (
          <p>Loading questions...</p>
        ) : (
          <div>
            {questions.map((q, idx) => (
              <div key={q.id} style={{ marginBottom: '24px', padding: '16px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <h4 style={{ marginBottom: '12px', fontSize: '16px', color: '#0f172a' }}>{idx + 1}. {q.question}</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {q.options.map((opt, optIdx) => (
                    <label key={optIdx} style={{ display: 'flex', alignItems: 'center', cursor: answers[q.id] !== undefined ? 'not-allowed' : 'pointer', fontSize: '15px', opacity: answers[q.id] !== undefined && answers[q.id] !== optIdx ? 0.6 : 1 }}>
                      <input 
                        type="radio" 
                        name={`question-${q.id}`} 
                        value={optIdx}
                        checked={answers[q.id] === optIdx}
                        onChange={() => handleAnswerSelect(q.id, optIdx)}
                        disabled={answers[q.id] !== undefined}
                      />
                      <span style={{ marginLeft: '8px' }}>{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ textAlign: 'right' }}>
              <button className="btn btn-primary" onClick={submitExamOnBackend}>
                Finish Exam
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
