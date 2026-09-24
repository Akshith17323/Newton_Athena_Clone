// App.jsx
import { useEffect, useRef, useState } from 'react'
import Quiz from './components/Quiz/Quiz'
import './App.css'

function App() {
  // state variables
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenShared, setScreenShared] = useState(false);
  const [folderSelected, setFolderSelected] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [timer, setTimer] = useState('');
  const [sessionId, setSessionId] = useState(null);
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

  useEffect(() => {
    // Register Listener for handling Timer Tick from Main
    const removeTimerTickListener = window.athena.registerListenerForTimerTickFromMain(setTimer);

    // Register Listener for handling Camera Snap Request from Main
    const removeCameraSnapListener = window.athena.registerListenerForCameraSnapFromMain(saveVideoScreenShots);

    // Register Listener for Keyboard inputs
    const removeKeyboardListener = window.athena.registerListenerForKeyboardInputFromMain((input) => {
      console.log("Keyboard input intercepted from main:", input);
    });

    return () => {
      removeTimerTickListener()
      removeCameraSnapListener()
      removeKeyboardListener()
    };
  }, []);

  // Save screenshots every 5 seconds when camera is enabled
  useEffect(() => {
    let intervalId;
    if (cameraEnabled) {
      intervalId = setInterval(() => {
        saveVideoScreenShots();
      }, 5000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [cameraEnabled]);

  async function saveVideoScreenShots() {
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
      window.athena.storeCameraSnapImageOnDisk(arrayBuffer, sessionId);

      // Also capture the desktop screen natively
      window.athena.captureScreen(sessionId);
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
    try {
      const response = await fetch('http://localhost:3000/exam/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: "user-123", // Replace with real user input later
          name: "Test User"
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
          <div style={{ marginTop: '20px', fontSize: '18px' }}>
            <p>Attempted: <strong>{examResults.attempted}</strong></p>
            <p style={{ color: '#16a34a' }}>Correct: <strong>{examResults.correct}</strong></p>
            <p style={{ color: '#dc2626' }}>Wrong: <strong>{examResults.wrong}</strong></p>
          </div>
          <button className="btn btn-primary" style={{ marginTop: '32px' }} onClick={() => {
            setExamResults(null);
            setSessionId(null);
            setRestoredAnswers({});
            localStorage.removeItem('athena_sessionId');
          }}>Start New Exam</button>
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
          timer={timer} 
          restoredAnswers={restoredAnswers} 
          onFinish={(results) => {
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
      <div className="bottom-actions">
        <button
          className="btn btn-primary"
          disabled={!cameraEnabled || !fullScreen || !screenShared || !folderSelected}
          onClick={async () => {
            try {
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
      </div>

      <div>
        {timer + ' (s) elapsed'}
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
