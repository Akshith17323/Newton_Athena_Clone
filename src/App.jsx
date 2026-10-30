// App.jsx
import { useEffect, useRef, useState } from 'react'
import Quiz from './components/Quiz/Quiz'
import './App.css'

function formatTime(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || totalSeconds === '') return '00:00';
  const sec = typeof totalSeconds === 'number' ? totalSeconds : parseInt(totalSeconds, 10);
  if (isNaN(sec)) return '00:00';
  const mins = Math.floor(sec / 60);
  const remainingSecs = sec % 60;
  return `${String(mins).padStart(2, '0')}:${String(remainingSecs).padStart(2, '0')}`;
}

function App() {
  // state variables
  const [studentName, setStudentName] = useState(() => localStorage.getItem('athena_studentName') || '');
  const [studentId, setStudentId] = useState(() => localStorage.getItem('athena_studentId') || '');
  const [violationCount, setViolationCount] = useState(0);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenShared, setScreenShared] = useState(false);
  const [folderSelected, setFolderSelected] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [timer, setTimer] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const sessionIdRef = useRef(null);

  // Keep ref in sync with state to avoid stale closures in intervals/listeners
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const [quizStarted, setQuizStarted] = useState(false);
  const [restoredAnswers, setRestoredAnswers] = useState({});
  const [examResults, setExamResults] = useState(null);
  // ref variables
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  // Keep video stream alive across re-renders
  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [quizStarted]);

  // Restore session on load
  useEffect(() => {
    const storedSessionId = localStorage.getItem('athena_sessionId');
    if (storedSessionId) {
      fetch(`http://localhost:3000/exam/session/${storedSessionId}`)
        .then(res => {
          if (!res.ok) throw new Error("Session not found");
          return res.json();
        })
        .then(data => {
          if (data.status === "in-progress") {
            setSessionId(storedSessionId);
            const newAnswers = {};
            data.answers.forEach(ans => {
              newAnswers[ans.questionId] = ans.selectedAnswer;
            });
            setRestoredAnswers(newAnswers);
          } else if (data.status === "submitted") {
            setExamResults({
              attempted: data.attempted,
              correct: data.correct,
              wrong: data.wrong
            });
          }
        })
        .catch(err => {
          console.error("Failed to restore session:", err);
          localStorage.removeItem('athena_sessionId');
        });
    }
  }, []);

  // Disable context menu for anti-cheat
  useEffect(() => {
    const handleContextMenu = (e) => e.preventDefault();
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  // Detect fullscreen exit
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setFullScreen(false);
        if (quizStarted) {
          setViolationCount((c) => {
            const next = c + 1;
            alert(`Anti-Cheat Warning: Fullscreen mode was exited! (Violation #${next})`);
            return next;
          });
        }
      } else {
        setFullScreen(true);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [quizStarted]);

  useEffect(() => {
    // Register Listener for handling Timer Tick from Main
    const removeTimerTickListener = window.athena.registerListenerForTimerTickFromMain(setTimer);

    // Register Listener for handling Camera Snap Request from Main
    const removeCameraSnapListener = window.athena.registerListenerForCameraSnapFromMain(saveVideoScreenShots);

    // Register Listener for Keyboard inputs
    const removeKeyboardListener = window.athena.registerListenerForKeyboardInputFromMain((input) => {
      console.log("Keyboard input intercepted from main:", input);
    });

    // Register Listener for window blur (anti-cheat focus loss)
    const removeWindowBlurListener = window.athena?.registerListenerForWindowBlur?.(() => {
      if (quizStarted) {
        setViolationCount((c) => {
          const next = c + 1;
          alert(`Anti-Cheat Warning: Window focus lost or external app selected! (Violation #${next})`);
          return next;
        });
      }
    });

    return () => {
      removeTimerTickListener();
      removeCameraSnapListener();
      removeKeyboardListener();
      if (removeWindowBlurListener) removeWindowBlurListener();
    };
  }, [quizStarted]);

  async function saveVideoScreenShots() {
    if (!sessionIdRef.current) return;
    
    if (!videoRef.current || !videoRef.current.srcObject) {
      return;
    }

    try {
      const track = videoRef.current.srcObject.getVideoTracks()[0];
      if (!track) return;

      // Use ImageCapture API
      const imageCapture = new ImageCapture(track);
      const blob = await imageCapture.takePhoto();
      const arrayBuffer = await blob.arrayBuffer();

      // Send raw binary buffer to main process
      window.athena.storeCameraSnapImageOnDisk(arrayBuffer, sessionIdRef.current);

      // Also capture the desktop screen natively
      window.athena.captureScreen(sessionIdRef.current);
    } catch (error) {
      console.error("Failed to capture image via ImageCapture:", error);
    }
  }

  async function getCameraAccess() {
    try {
      const videoData = await navigator.mediaDevices.getUserMedia({
        video: true
      });

      streamRef.current = videoData;
      if (videoRef.current) {
        videoRef.current.srcObject = videoData;
      }
      setCameraEnabled(true);
    } catch (error) {
      console.error(error);
      alert('Cannot access Camera');
    }
  }

  async function getScreenAccess() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
      setScreenShared(true);
      // Listen for stream stop to revoke permission state if user stops sharing
      stream.getVideoTracks()[0].onended = () => {
        setScreenShared(false);
      };
    } catch (error) {
      console.error(error);
      alert('Cannot access Screen Share');
    }
  }

  async function handleSelectFolder() {
    try {
      const path = await window.athena.selectFolder();
      if (path) {
        setFolderSelected(true);
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function enableFullScreen() {
    try {
      await document.documentElement.requestFullscreen();
      setFullScreen(true);
    } catch (error) {
      console.error(error);
      alert('Cannot access full screen');
    }
  }

  async function startExamOnBackend() {
    if (!studentName.trim() || !studentId.trim()) {
      alert("Please enter both your Full Name and Student ID before proceeding.");
      return;
    }

    if (window.athena?.checkMultipleDisplays) {
      const hasMultiple = await window.athena.checkMultipleDisplays();
      if (hasMultiple) {
        alert("Anti-Cheat Alert: Multiple displays detected. Please disconnect external monitors before starting the exam.");
        return;
      }
    }

    try {
      localStorage.setItem('athena_studentName', studentName.trim());
      localStorage.setItem('athena_studentId', studentId.trim());

      const response = await fetch('http://localhost:3000/exam/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: studentId.trim(),
          name: studentName.trim()
        })
      });
      const data = await response.json();
      if (response.ok) {
        console.log("Exam started with Session ID:", data.sessionId);
        setSessionId(data.sessionId);
        setQuizStarted(true);
        localStorage.setItem('athena_sessionId', data.sessionId);
      } else {
        console.error("Failed to start exam:", data.message);
        alert("Failed to start exam: " + data.message);
      }
    } catch (error) {
      console.error("Network error:", error);
      alert("Network error: " + error.message + " (Make sure the backend is running at localhost:3000!)");
    }
  }

  if (examResults) {
    return (
      <div className="page-container">
        <div className="card-container" style={{ textAlign: 'center' }}>
          <h2>Exam Results</h2>
          {studentName && (
            <p style={{ color: '#64748b', marginTop: '6px', fontSize: '15px' }}>
              Candidate: <strong>{studentName}</strong> {studentId ? `(${studentId})` : ''}
            </p>
          )}
          <div style={{ marginTop: '20px', fontSize: '18px' }}>
            <p>Attempted: <strong>{examResults.attempted}</strong></p>
            <p style={{ color: '#16a34a' }}>Correct: <strong>{examResults.correct}</strong></p>
            <p style={{ color: '#dc2626' }}>Wrong: <strong>{examResults.wrong}</strong></p>
            {violationCount > 0 && (
              <p style={{ color: '#d97706', marginTop: '8px' }}>
                Proctoring Warnings: <strong>{violationCount}</strong>
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '32px' }}>
            <button className="btn btn-primary" onClick={() => {
              setExamResults(null);
              setSessionId(null);
              setRestoredAnswers({});
              localStorage.removeItem('athena_sessionId');
            }}>Start New Exam</button>
            <button className="btn btn-outline" style={{ color: '#dc2626', borderColor: '#fca5a5' }} onClick={() => {
              window.athena?.exitExam(false);
            }}>Exit Exam</button>
          </div>
        </div>
      </div>
    );
  }

  if (quizStarted) {
    return (
      <div style={{ position: 'relative' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          style={{ position: 'fixed', bottom: '20px', right: '20px', width: '150px', borderRadius: '8px', zIndex: 1000, boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
        />
        <Quiz 
          key={sessionId}
          sessionId={sessionId} 
          studentName={studentName}
          studentId={studentId}
          timer={timer} 
          violationCount={violationCount}
          restoredAnswers={restoredAnswers} 
          onFinish={(results) => {
            window.athena?.stopTimerOnMain?.();
            setExamResults(results);
            setQuizStarted(false);
          }} 
        />
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Main Card */}
      <div className="card-container">
        {/* Section 0: Candidate Details */}
        <div className="permission-item">
          <div className="permission-content" style={{ width: '100%' }}>
            <h3>Candidate Details</h3>
            <p>Enter your full name and student ID / roll number before starting.</p>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '220px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#475569' }}>
                  Full Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. John Doe"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              <div style={{ flex: 1, minWidth: '220px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#475569' }}>
                  Student ID / Roll No.
                </label>
                <input
                  type="text"
                  placeholder="e.g. CS2026-001"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="divider"></div>

        {/* Section 1: Camera / Heimdall */}
        <div className="permission-item">
          <div className="permission-content">
            <h3>Configure Camera</h3>
            <p>Kindly configure Camera to attempt quiz/contests.</p>
            <div className="action-row">
              <button
                className="btn btn-black"
                disabled={cameraEnabled}
                onClick={getCameraAccess}
              >
                {cameraEnabled ? 'Camera Connected' : 'Get Camera Access'}
              </button>

              {/* Hidden/Active Video Feed Preview */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className={`video-preview`}
              />
            </div>
          </div>
        </div>

        <div className="divider"></div>

        {/* Section: Screen Share */}
        <div className="permission-item">
          <div className="permission-content">
            <h3>Share Screen</h3>
            <p>Kindly share your entire screen for monitoring.</p>
            <div className="action-row">
              <button
                className="btn btn-black"
                disabled={screenShared}
                onClick={getScreenAccess}
              >
                {screenShared ? 'Screen Shared' : 'Share Screen'}
              </button>
            </div>
          </div>
        </div>

        <div className="divider"></div>

        {/* Section: Select Folder */}
        <div className="permission-item">
          <div className="permission-content">
            <h3>Select Folder</h3>
            <p>Select a folder to save captured screenshots.</p>
            <div className="action-row">
              <button
                className="btn btn-black"
                disabled={folderSelected}
                onClick={handleSelectFolder}
              >
                {folderSelected ? 'Folder Selected' : 'Select Folder'}
              </button>
            </div>
          </div>
        </div>

        <div className="divider"></div>

        {/* Section: Fullscreen */}
        <div className="permission-item">
          <div className="permission-content">
            <h3>Switch to full screen</h3>
            <button
              className="btn btn-primary"
              disabled={fullScreen}
              onClick={() => {
                enableFullScreen();
              }}
            >
              {fullScreen ? 'Full Screen Enabled' : 'Give Full Screen Permissions'}
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Action Buttons */}
      <div className="bottom-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          className="btn btn-primary"
          disabled={!sessionId && (!studentName.trim() || !studentId.trim() || !cameraEnabled || !fullScreen || !screenShared || !folderSelected)}
          onClick={async () => {
            try {
              if (window.athena?.checkMultipleDisplays) {
                const hasMultiple = await window.athena.checkMultipleDisplays();
                if (hasMultiple) {
                  alert("Anti-Cheat Alert: Multiple displays detected. Please disconnect external monitors before starting the exam.");
                  return;
                }
              }

              if (sessionId) {
                setQuizStarted(true);
                await window.athena.startTimerOnMain();
              } else {
                await startExamOnBackend();
                await window.athena.startTimerOnMain();
              }
            } catch (error) {
              console.error(error);
            }
          }}
        >
          {sessionId ? "Resume Test" : "Go To Test"}
        </button>

        <button 
          className="btn btn-outline" 
          style={{ color: '#dc2626', borderColor: '#fca5a5' }}
          onClick={() => window.athena?.exitExam(true)}
        >
          Exit Exam
        </button>
      </div>

      <div>
        {formatTime(timer)} elapsed
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '20px', flexWrap: 'wrap' }}>
        <button className="btn btn-outline" onClick={() => {
          saveVideoScreenShots()
        }}>
          Capture Snapshot
        </button>

        <button className="btn btn-outline" onClick={() => {
          window.athena.showRules()
        }}>
          Show Native Rules
        </button>

        <button className="btn btn-outline" onClick={() => { alert("Rules ...") }}>
          Show Chromium Rules
        </button>
      </div>

    </div>
  );
}

export default App
