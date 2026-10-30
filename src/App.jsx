// App.jsx
import { useEffect, useRef, useState } from 'react';
import Quiz from './components/Quiz/Quiz';
import './App.css';

function App() {
  // Candidate & Proctoring State
  const [studentName, setStudentName] = useState(() => localStorage.getItem('athena_studentName') || '');
  const [studentId, setStudentId] = useState(() => localStorage.getItem('athena_studentId') || '');
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!localStorage.getItem('athena_studentName'));
  const [violationCount, setViolationCount] = useState(0);

  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenShared, setScreenShared] = useState(false);
  const [folderSelected, setFolderSelected] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);

  const [timer, setTimer] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const sessionIdRef = useRef(null);

  const [quizStarted, setQuizStarted] = useState(false);
  const [restoredAnswers, setRestoredAnswers] = useState({});
  const [examResults, setExamResults] = useState(null);

  // Modals & UI states
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Keep video stream alive across re-renders
  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [quizStarted, showPermissionsModal]);

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

  // Anti-cheat: prevent right click
  useEffect(() => {
    const handleContextMenu = (e) => e.preventDefault();
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  // Automatically check if application is already full screen
  useEffect(() => {
    async function checkFullscreenStatus() {
      if (window.athena?.isFullScreen) {
        try {
          const isFs = await window.athena.isFullScreen();
          if (isFs) {
            setFullScreen(true);
          }
        } catch (err) {
          console.error("Error checking fullscreen:", err);
        }
      } else if (document.fullscreenElement || window.innerHeight >= screen.availHeight) {
        setFullScreen(true);
      }
    }
    checkFullscreenStatus();

    const removeElectronFsListener = window.athena?.registerListenerForFullscreenChange?.((isFs) => {
      setFullScreen(isFs);
      if (!isFs && quizStarted) {
        setViolationCount((c) => {
          const next = c + 1;
          alert(`Anti-Cheat Warning: Fullscreen mode was exited! (Violation #${next})`);
          return next;
        });
      }
    });

    const handleDomFsChange = () => {
      if (!document.fullscreenElement) {
        if (window.athena?.isFullScreen) {
          window.athena.isFullScreen().then(isFs => {
            setFullScreen(isFs);
            if (!isFs && quizStarted) {
              setViolationCount(c => c + 1);
            }
          });
        } else {
          setFullScreen(false);
        }
      } else {
        setFullScreen(true);
      }
    };

    document.addEventListener('fullscreenchange', handleDomFsChange);

    return () => {
      if (removeElectronFsListener) removeElectronFsListener();
      document.removeEventListener('fullscreenchange', handleDomFsChange);
    };
  }, [quizStarted]);

  async function saveVideoScreenShots() {
    if (!sessionIdRef.current) return;
    if (!videoRef.current || !videoRef.current.srcObject) return;

    try {
      const track = videoRef.current.srcObject.getVideoTracks()[0];
      if (!track) return;

      const imageCapture = new ImageCapture(track);
      const blob = await imageCapture.takePhoto();
      const arrayBuffer = await blob.arrayBuffer();

      window.athena?.storeCameraSnapImageOnDisk?.(arrayBuffer, sessionIdRef.current);
      window.athena?.captureScreen?.(sessionIdRef.current);
    } catch (error) {
      console.error("Failed to capture image via ImageCapture:", error);
    }
  }

  // Main IPC listeners
  useEffect(() => {
    const removeTimerTickListener = window.athena?.registerListenerForTimerTickFromMain?.(setTimer) || (() => {});
    const removeCameraSnapListener = window.athena?.registerListenerForCameraSnapFromMain?.(saveVideoScreenShots) || (() => {});
    const removeKeyboardListener = window.athena?.registerListenerForKeyboardInputFromMain?.((input) => {
      console.log("Keyboard input intercepted from main:", input);
    }) || (() => {});

    const removeWindowBlurListener = window.athena?.registerListenerForWindowBlur?.(() => {
      if (quizStarted) {
        setViolationCount((c) => {
          const next = c + 1;
          alert(`Anti-Cheat Warning: Window focus lost or external app selected! (Violation #${next})`);
          return next;
        });
      }
    }) || (() => {});

    return () => {
      removeTimerTickListener();
      removeCameraSnapListener();
      removeKeyboardListener();
      removeWindowBlurListener();
    };
  }, [quizStarted]);

  async function getCameraAccess() {
    try {
      const videoData = await navigator.mediaDevices.getUserMedia({ video: true });
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
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      setScreenShared(true);
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
      const path = await window.athena?.selectFolder?.();
      if (path) {
        setFolderSelected(true);
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function enableFullScreen() {
    try {
      if (window.athena?.isFullScreen) {
        const isFs = await window.athena.isFullScreen();
        if (isFs) {
          setFullScreen(true);
          return;
        }
      }
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
      setFullScreen(true);
    } catch (error) {
      console.error(error);
      setFullScreen(true);
    }
  }

  async function startExamOnBackend() {
    if (!studentName.trim() || !studentId.trim()) {
      alert("Please enter both your Full Name and Student ID.");
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
        headers: { 'Content-Type': 'application/json' },
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
        setShowPermissionsModal(false);
        localStorage.setItem('athena_sessionId', data.sessionId);
        await window.athena?.startTimerOnMain?.();
      } else {
        alert("Failed to start exam: " + data.message);
      }
    } catch (error) {
      console.error("Network error:", error);
      alert("Network error: " + error.message + " (Make sure the backend is running at localhost:3000!)");
    }
  }

  const isPermissionsReady = cameraEnabled && screenShared && folderSelected && fullScreen && studentName.trim() && studentId.trim();

  function handleStartTestClick() {
    if (sessionId) {
      setQuizStarted(true);
      window.athena?.startTimerOnMain?.();
      return;
    }

    if (isPermissionsReady) {
      startExamOnBackend();
    } else {
      setShowPermissionsModal(true);
    }
  }

  // Get user initials for avatar
  const initials = studentName
    .split(' ')
    .filter(Boolean)
    .map(p => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'NS';

  if (examResults) {
    return (
      <div className="app-wrapper">
        {/* Navbar */}
        <header className="navbar">
          <div className="navbar-left">
            <div className="batch-pill">
              <svg className="batch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                <line x1="8" y1="21" x2="16" y2="21"></line>
                <line x1="12" y1="17" x2="12" y2="21"></line>
              </svg>
              <span>NST'24 CS+AI RU</span>
              <svg className="chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>
          </div>
          <div className="navbar-right">
            <div className="xp-badge">
              <span className="xp-label">Total XP</span>
              <span className="xp-value">
                <svg className="xp-icon" viewBox="0 0 24 24" fill="#f59e0b">
                  <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5zm1 14h-2v-4H9l4-7v4h2l-2 7z" />
                </svg>
                11,178
              </span>
            </div>
            <div className="avatar-circle">{initials}</div>
          </div>
        </header>

        <main className="main-container">
          <div className="test-card" style={{ textAlign: 'center', padding: '36px 28px' }}>
            <h2 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a' }}>Exam Results</h2>
            <p style={{ color: '#64748b', marginTop: '6px', fontSize: '14.5px' }}>
              Candidate: <strong>{studentName}</strong> ({studentId})
            </p>

            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'center', gap: '28px' }}>
              <div style={{ padding: '16px 24px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Attempted</div>
                <div style={{ fontSize: '24px', fontWeight: '700', color: '#0f172a', marginTop: '4px' }}>{examResults.attempted}</div>
              </div>
              <div style={{ padding: '16px 24px', background: '#f0fdf4', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
                <div style={{ fontSize: '12px', color: '#166534', fontWeight: '600', textTransform: 'uppercase' }}>Correct</div>
                <div style={{ fontSize: '24px', fontWeight: '700', color: '#16a34a', marginTop: '4px' }}>{examResults.correct}</div>
              </div>
              <div style={{ padding: '16px 24px', background: '#fef2f2', borderRadius: '12px', border: '1px solid #fecaca' }}>
                <div style={{ fontSize: '12px', color: '#991b1b', fontWeight: '600', textTransform: 'uppercase' }}>Wrong</div>
                <div style={{ fontSize: '24px', fontWeight: '700', color: '#dc2626', marginTop: '4px' }}>{examResults.wrong}</div>
              </div>
            </div>

            {violationCount > 0 && (
              <p style={{ color: '#d97706', marginTop: '20px', fontSize: '14px', fontWeight: '500' }}>
                Proctoring Warnings Recorded: <strong>{violationCount}</strong>
              </p>
            )}

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '36px' }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setExamResults(null);
                  setSessionId(null);
                  setRestoredAnswers({});
                  localStorage.removeItem('athena_sessionId');
                }}
              >
                Start New Exam
              </button>
              <button
                className="btn btn-outline"
                style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                onClick={() => window.athena?.exitExam?.(false)}
              >
                Exit App
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (quizStarted) {
    return (
      <div style={{ position: 'relative', width: '100%', minHeight: '100vh', backgroundColor: '#ffffff' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          style={{
            position: 'fixed',
            bottom: '76px',
            right: '28px',
            width: '180px',
            height: '105px',
            objectFit: 'cover',
            borderRadius: '6px',
            zIndex: 1000,
            boxShadow: '0 8px 18px rgba(0,0,0,0.2)',
            border: '2px solid #0f172a',
            backgroundColor: '#000000'
          }}
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
    <div className="app-wrapper">
      {/* Top Navbar matching Screenshot */}
      <header className="navbar">
        <div className="navbar-left">
          <div className="batch-pill">
            <svg className="batch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
            <span>NST'24 CS+AI RU</span>
            <svg className="chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
        </div>

        <div className="navbar-right">
          {isLoggedIn ? (
            <div className="profile-pill" onClick={() => setShowProfileMenu(p => !p)}>
              <span style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a', marginRight: '4px' }}>
                {studentName}
              </span>
              <div className="avatar-circle">
                {initials}
              </div>
              <svg className="chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>

              {showProfileMenu && (
                <div style={{
                  position: 'absolute',
                  top: '42px',
                  right: '0',
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
                  width: '180px',
                  padding: '6px',
                  zIndex: 200
                }}>
                  <div style={{ padding: '8px 12px', fontSize: '13px', fontWeight: '600', color: '#0f172a', borderBottom: '1px solid #f1f5f9' }}>
                    {studentName}
                    <div style={{ fontSize: '11px', fontWeight: '400', color: '#64748b' }}>{studentId}</div>
                  </div>
                  <button
                    style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 12px', fontSize: '13px', cursor: 'pointer', borderRadius: '6px' }}
                    onClick={() => setShowRulesModal(true)}
                  >
                    Exam Rules
                  </button>
                  <button
                    style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 12px', fontSize: '13px', cursor: 'pointer', borderRadius: '6px' }}
                    onClick={() => {
                      localStorage.removeItem('athena_studentName');
                      localStorage.removeItem('athena_studentId');
                      setIsLoggedIn(false);
                      setShowProfileMenu(false);
                    }}
                  >
                    Switch User
                  </button>
                  <button
                    style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 12px', fontSize: '13px', color: '#dc2626', cursor: 'pointer', borderRadius: '6px' }}
                    onClick={() => window.athena?.exitExam?.(true)}
                  >
                    Exit Exam
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              className="btn btn-outline btn-sm"
              style={{ color: '#dc2626', borderColor: '#fca5a5' }}
              onClick={() => window.athena?.exitExam?.(true)}
            >
              Exit
            </button>
          )}
        </div>
      </header>

      {/* Main Page Area */}
      <main className="main-container">
        {!isLoggedIn ? (
          <div className="login-container">
            <h2 className="login-title">Candidate Sign In</h2>
            <p className="login-subtitle">Enter your name and student ID to access the examination portal.</p>

            <div className="login-field">
              <label className="login-label">Full Name</label>
              <input
                type="text"
                className="login-input"
                placeholder="e.g. Akshith Kumar"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
              />
            </div>

            <div className="login-field">
              <label className="login-label">Student ID / Roll Number</label>
              <input
                type="text"
                className="login-input"
                placeholder="e.g. NST-2024-AI"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
              />
            </div>

            <button
              className="login-btn"
              disabled={!studentName.trim() || !studentId.trim()}
              onClick={() => {
                if (studentName.trim() && studentId.trim()) {
                  localStorage.setItem('athena_studentName', studentName.trim());
                  localStorage.setItem('athena_studentId', studentId.trim());
                  setIsLoggedIn(true);
                }
              }}
            >
              Sign In & Continue
            </button>
          </div>
        ) : (
          <>
            {/* Back Link */}
            <button className="back-link" onClick={() => window.athena?.exitExam?.(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
              <span>Back</span>
            </button>

            {/* Central Test Details Card */}
        <div className="test-card">
          {/* Top Graphic Banner */}
          <div className="banner-graphic-container">
            {/* Mint Wave Concentric Rings SVG */}
            <svg
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
              viewBox="0 0 600 160"
              preserveAspectRatio="none"
            >
              <rect width="600" height="160" fill="#ebf8f2" />
              {/* Left Waves */}
              <circle cx="300" cy="80" r="190" fill="none" stroke="#d5ede2" strokeWidth="22" />
              <circle cx="300" cy="80" r="145" fill="none" stroke="#bfe5d1" strokeWidth="24" />
              <circle cx="300" cy="80" r="102" fill="none" stroke="#a4dac0" strokeWidth="22" />
            </svg>

            {/* Centered White Circle with Green Clipboard */}
            <div className="banner-circle">
              <div className="banner-clipboard">
                <div className="banner-clip"></div>
                <div className="banner-line"></div>
                <div className="banner-line"></div>
                <div className="banner-line"></div>
              </div>
            </div>
          </div>

          {/* Details Content */}
          <div className="card-content">
            <div className="meta-label">Playlist Title</div>
            <div className="playlist-title">Gated Architectures, LSTM, GRU - Revision</div>

            <div className="meta-label">Test Syllabus</div>
            <div className="syllabus-text">Gated Architectures, LSTM, GRU</div>

            {/* Metadata Info Rows */}
            <div className="meta-info-grid">
              <div className="meta-row">
                {/* Scheduled For */}
                <div className="meta-item">
                  <div className="meta-icon-box">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                      <line x1="16" y1="2" x2="16" y2="6"></line>
                      <line x1="8" y1="2" x2="8" y2="6"></line>
                      <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                  </div>
                  <div>
                    <div className="meta-info-title">Scheduled For</div>
                    <div className="meta-info-value">Oct 29, 2026 3:35 PM</div>
                  </div>
                </div>

                <div className="meta-divider"></div>

                {/* Number of Questions */}
                <div className="meta-item">
                  <div className="meta-icon-box">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="16" y1="13" x2="8" y2="13"></line>
                      <line x1="16" y1="17" x2="8" y2="17"></line>
                      <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                  </div>
                  <div>
                    <div className="meta-info-title">Number of Questions</div>
                    <div className="meta-info-value">4 Questions</div>
                  </div>
                </div>
              </div>

              {/* Total XP */}
              <div className="meta-row">
                <div className="meta-item">
                  <div className="meta-icon-box xp">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </div>
                  <div>
                    <div className="meta-info-title">Total XP</div>
                    <div className="meta-info-value">22</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Start Test CTA */}
            <button className="start-test-btn" onClick={handleStartTestClick}>
              {sessionId ? "Resume Test" : "Start Test"}
            </button>
          </div>
        </div>
          </>
        )}
      </main>

      {/* Permissions / Proctoring Setup Modal */}
      {showPermissionsModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <h3>Kindly Allow Permissions to Start the Test</h3>
              <button className="modal-close-btn" onClick={() => setShowPermissionsModal(false)}>×</button>
            </div>

            {/* Candidate Details Step */}
            <div className="permission-step">
              <div className="permission-step-header">
                <span className="permission-step-title">Candidate Details</span>
                <span className={`permission-step-status ${studentName.trim() && studentId.trim() ? 'status-granted' : 'status-pending'}`}>
                  {studentName.trim() && studentId.trim() ? 'Ready' : 'Required'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
                <input
                  type="text"
                  placeholder="Full Name"
                  value={studentName}
                  onChange={e => setStudentName(e.target.value)}
                  style={{ flex: 1, minWidth: '180px', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
                <input
                  type="text"
                  placeholder="Student ID / Roll No."
                  value={studentId}
                  onChange={e => setStudentId(e.target.value)}
                  style={{ flex: 1, minWidth: '180px', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                />
              </div>
            </div>

            {/* Camera Permission Step */}
            <div className="permission-step">
              <div className="permission-step-header">
                <span className="permission-step-title">1. Camera Access (Heimdall)</span>
                <span className={`permission-step-status ${cameraEnabled ? 'status-granted' : 'status-pending'}`}>
                  {cameraEnabled ? 'Connected' : 'Pending'}
                </span>
              </div>
              <p style={{ fontSize: '12.5px', color: '#64748b', marginBottom: '10px' }}>
                Proctoring requires active webcam monitoring throughout the exam.
              </p>
              <button className="btn btn-black btn-sm" disabled={cameraEnabled} onClick={getCameraAccess}>
                {cameraEnabled ? 'Camera Connected ✓' : 'Enable Camera'}
              </button>
              {cameraEnabled && (
                <video ref={videoRef} autoPlay playsInline className="video-thumb" />
              )}
            </div>

            {/* Screen Share Permission Step */}
            <div className="permission-step">
              <div className="permission-step-header">
                <span className="permission-step-title">2. Screen Share Permission</span>
                <span className={`permission-step-status ${screenShared ? 'status-granted' : 'status-pending'}`}>
                  {screenShared ? 'Shared' : 'Pending'}
                </span>
              </div>
              <p style={{ fontSize: '12.5px', color: '#64748b', marginBottom: '10px' }}>
                Share your entire screen for automated compliance monitoring.
              </p>
              <button className="btn btn-black btn-sm" disabled={screenShared} onClick={getScreenAccess}>
                {screenShared ? 'Screen Shared ✓' : 'Share Screen'}
              </button>
            </div>

            {/* Storage Folder Selection Step */}
            <div className="permission-step">
              <div className="permission-step-header">
                <span className="permission-step-title">3. Proctoring Snapshot Directory</span>
                <span className={`permission-step-status ${folderSelected ? 'status-granted' : 'status-pending'}`}>
                  {folderSelected ? 'Selected' : 'Pending'}
                </span>
              </div>
              <p style={{ fontSize: '12.5px', color: '#64748b', marginBottom: '10px' }}>
                Choose where periodic monitoring snapshots are saved.
              </p>
              <button className="btn btn-black btn-sm" disabled={folderSelected} onClick={handleSelectFolder}>
                {folderSelected ? 'Folder Selected ✓' : 'Select Folder'}
              </button>
            </div>

            {/* Fullscreen Mode Step */}
            <div className="permission-step">
              <div className="permission-step-header">
                <span className="permission-step-title">4. Full-Screen Mode</span>
                <span className={`permission-step-status ${fullScreen ? 'status-granted' : 'status-pending'}`}>
                  {fullScreen ? 'Active' : 'Pending'}
                </span>
              </div>
              <p style={{ fontSize: '12.5px', color: '#64748b', marginBottom: '10px' }}>
                Exam must be taken strictly in full-screen mode with external tabs closed.
              </p>
              <button className="btn btn-primary btn-sm" disabled={fullScreen} onClick={enableFullScreen}>
                {fullScreen ? 'Full Screen Enabled ✓' : 'Enable Full Screen'}
              </button>
            </div>

            {/* Modal Bottom Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button className="btn btn-outline btn-sm" onClick={() => setShowPermissionsModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={!isPermissionsReady}
                onClick={startExamOnBackend}
              >
                Launch Test
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rules Modal */}
      {showRulesModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <h3>Athena Exam Rules & Guidelines</h3>
              <button className="modal-close-btn" onClick={() => setShowRulesModal(false)}>×</button>
            </div>
            <div style={{ fontSize: '14px', color: '#475569', lineHeight: '1.8', marginBottom: '24px' }}>
              <p>1. <strong>Full Screen:</strong> You must remain in full-screen mode throughout the exam.</p>
              <p>2. <strong>Camera & Screen Share:</strong> Web camera and screen monitoring must remain active.</p>
              <p>3. <strong>Anti-Cheat:</strong> Tab switching, secondary displays, developer tools, and copy/paste are strictly blocked.</p>
              <p>4. <strong>Automated Proctoring:</strong> Periodic webcam snaps and screen captures are saved for audit.</p>
              <p>5. <strong>Submission:</strong> Complete all questions and click Finish Exam when ready.</p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary btn-sm" onClick={() => setShowRulesModal(false)}>
                I Understand
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
