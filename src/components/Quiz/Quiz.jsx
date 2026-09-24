import { useState, useEffect } from 'react';

export default function Quiz({ sessionId, timer, restoredAnswers, onFinish }) {
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState(restoredAnswers || {});
  const [currentIndex, setCurrentIndex] = useState(0);

  // Fetch questions
  useEffect(() => {
    fetch('http://localhost:3000/exam/mcq')
      .then(res => res.json())
      .then(data => setQuestions(data))
      .catch(err => console.error("Failed to fetch questions:", err));
  }, []);

  async function handleAnswerSelect(questionId, selectedAnswerIndex) {
    if (answers[questionId] !== undefined) return; // Prevent changing answer
    
    // Optimistically update UI
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
      }
    } catch (err) {
      console.error("Network error submitting answer:", err);
    }
  }

  async function submitExamOnBackend() {
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
      }
    } catch (err) {
      console.error("Failed to submit exam:", err);
    }
  }

  if (questions.length === 0) {
    return <div className="page-container"><p>Loading questions...</p></div>;
  }

  const currentQuestion = questions[currentIndex];
  const isAnswered = answers[currentQuestion.id] !== undefined;
  const selectedOptIndex = answers[currentQuestion.id];

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
      </div>

      {/* Main Question Area */}
      <div className="card-container" style={{ flex: 1, textAlign: 'left', minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid #e2e8f0', paddingBottom: '16px' }}>
          <h2>Question {currentIndex + 1} of {questions.length}</h2>
          <div style={{ fontWeight: 'bold', color: '#dc2626', fontSize: '18px' }}>Time: {timer}s</div>
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
              let cursorStyle = 'pointer';

              if (isAnswered) {
                cursorStyle = 'not-allowed';
                if (isThisSelected) {
                  bgColor = '#eff6ff'; // light blue
                  borderColor = '#3b82f6'; // blue
                  textColor = '#1e3a8a'; // dark blue
                } else {
                  bgColor = '#f8fafc';
                  borderColor = '#e2e8f0';
                  textColor = '#94a3b8'; // gray out unselected
                }
              }

              return (
                <div 
                  key={optIdx} 
                  onClick={() => handleAnswerSelect(currentQuestion.id, optIdx)}
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    padding: '16px', 
                    border: `2px solid ${borderColor}`, 
                    borderRadius: '8px',
                    backgroundColor: bgColor,
                    color: textColor,
                    cursor: cursorStyle,
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
            <button className="btn btn-primary" style={{ backgroundColor: '#10b981', borderColor: '#10b981' }} onClick={submitExamOnBackend}>
              Finish Exam
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
