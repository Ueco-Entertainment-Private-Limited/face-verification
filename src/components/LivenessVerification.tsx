import { useCallback, useRef, useState, useEffect } from "react";
import { processFrame, completeFaceVerification, createSession, startLivenessApi, endSession } from "../utils/api";

const LivenessVerification = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const processingFrameRef = useRef(false);
  const lastFrameTimeRef = useRef(0);
  const verificationCompleteRef = useRef(false);
  const capturedImageRef = useRef<string | null>(null);
  const lastTaskRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [taskText, setTaskText] = useState("");
  const [active, setActive] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [verificationSuccess, setVerificationSuccess] = useState(false);
  const [remainingTime, setRemainingTime] = useState<number>(30);
  const [cameraReady, setCameraReady] = useState(false);

  const params = new URLSearchParams(window.location.search);
  const userId = params.get("userId");

  if (!userId) {
    alert("UserId missing. Open this page from app.");
    throw new Error("UserId missing");
  }

  const addLog = (msg: string) => {
    console.log(msg);
  };

  /* ---------------- VOICE ---------------- */
  let femaleVoice: SpeechSynthesisVoice | null = null;

  const loadVoices = () => {
    const voices = window.speechSynthesis.getVoices();
    femaleVoice =
      voices.find(v => v.name.includes("Female")) ||
      voices.find(v => v.name.includes("Google")) ||
      voices.find(v => v.name.includes("Samantha")) ||
      voices.find(v => v.lang === "en-US") ||
      voices[0];
  };

  if (typeof window !== 'undefined') {
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
  }

  const speak = (text: string) => {
    if (!text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (femaleVoice) u.voice = femaleVoice;
    u.lang = "en-US";
    u.rate = 0.9;
    u.pitch = 1.2;
    window.speechSynthesis.speak(u);
  };

  const speakTask = (text: string) => {
    const t = text.toLowerCase();
    if (t.includes('left')) speak('Please look left');
    else if (t.includes('right')) speak('Please look right');
    else if (t.includes('down')) speak('Please look down');
    else if (t.includes('up')) speak('Please look up');
    else if (t.includes('close')) speak('Please close your eyes');
    else if (t.includes('blink')) speak('Please blink');
    else speak(text);
  };

  /* ---------------- CAMERA SETUP ---------------- */
  const getUserMedia = useCallback(async (): Promise<boolean> => {
    try {
      addLog("📷 Requesting camera access...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise<void>((resolve, reject) => {
          videoRef.current!.onloadedmetadata = () => {
            if (canvasRef.current && videoRef.current) {
              canvasRef.current.width = videoRef.current.videoWidth;
              canvasRef.current.height = videoRef.current.videoHeight;
            }
            addLog("✅ Camera ready");
            setCameraReady(true);
            resolve();
          };
          videoRef.current!.onerror = reject;
          setTimeout(() => reject(new Error("Camera timeout")), 10000);
        });
      }
      return true;
    } catch (err: any) {
      addLog("❌ Camera error: " + err.message);
      setError("Camera access denied: " + err.message);
      setCameraReady(false);
      return false;
    }
  }, []);

  /* ---------------- TIMEOUT HANDLER ---------------- */
  const handleTimeout = async () => {
    addLog("⏰ 30 seconds timeout - ending session");
    speak("Time limit exceeded");
    setError("Liveness verification timeout. Please try again.");
    setIsStreaming(false);
    setActive(false);
    verificationCompleteRef.current = true;
    setDisabled(false);
    setRemainingTime(30);

    if (sessionId) {
      try {
        await endSession(sessionId);
        addLog("✅ Session ended");
      } catch (err) {
        console.error("Error ending session:", err);
      }
    }
  };

  /* ---------------- HANDLE FRAME RESPONSE ---------------- */
  const handleFrameResponse = (res: any) => {
    if (res.face_detected === false) {
      setFaceDetected(false);
      return;
    }

    setFaceDetected(true);

    if (res.task_session?.active && res.task_session?.current_task) {
      const desc = res.task_session.current_task.description;

      if (desc !== lastTaskRef.current) {
        lastTaskRef.current = desc;
        setTaskText(desc);
        speakTask(desc);
        addLog(`📋 Task: ${desc}`);
      }
      setActive(true);
    }

    if (res.task_session && !res.task_session.active && res.task_session.result) {
      verificationCompleteRef.current = true;
      setActive(false);
      setIsStreaming(false);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setRemainingTime(30);

      if (res.task_session.result.final_result) {
        addLog("✅ Liveness verification successful!");
        speak('Liveness verification successful');
        completeVerification();
      } else {
        addLog("❌ Liveness verification failed");
        speak('Liveness verification failed');
        setError('Liveness failed. Please try again');
        setDisabled(false);
        setTaskText('');

        if (sessionId) {
          endSession(sessionId).catch(err => console.error("Error ending session:", err));
        }
      }
    }
  };

  /* ---------------- FRAME PROCESSING ---------------- */
  const captureAndProcessFrame = useCallback(async () => {
    if (!sessionId || !videoRef.current || !canvasRef.current) return;
    if (videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) return;
    if (processingFrameRef.current || verificationCompleteRef.current) return;

    const now = Date.now();
    const timeSinceLastFrame = now - lastFrameTimeRef.current;

    if (timeSinceLastFrame < 0) return;

    try {
      processingFrameRef.current = true;
      lastFrameTimeRef.current = now;

      const ctx = canvasRef.current.getContext("2d")!;
      ctx.drawImage(videoRef.current, 0, 0);
      const frameData = canvasRef.current.toDataURL("image/jpeg", 0.6);

      const response = await processFrame(sessionId, frameData);

      if (response) {
        handleFrameResponse(response);
        setError(null);
      }
    } catch (err: any) {
      console.error("Frame processing error:", err);
      if (err.message?.includes('session')) {
        setError('Session expired. Please restart.');
        setIsStreaming(false);
      }
    } finally {
      processingFrameRef.current = false;
    }
  }, [sessionId]);

  /* ---------------- CONTINUOUS FRAME LOOP ---------------- */
  const frameLoop = useCallback(() => {
    captureAndProcessFrame();
    if (isStreaming && !verificationCompleteRef.current) {
      animationFrameRef.current = requestAnimationFrame(frameLoop);
    }
  }, [isStreaming, captureAndProcessFrame]);

  useEffect(() => {
    if (isStreaming) {
      lastFrameTimeRef.current = Date.now();
      animationFrameRef.current = requestAnimationFrame(frameLoop);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isStreaming, frameLoop]);

  /* ---------------- COUNTDOWN TIMER ---------------- */
  useEffect(() => {
    if (isStreaming && !verificationCompleteRef.current) {
      setRemainingTime(30);
      const interval = setInterval(() => {
        setRemainingTime(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [isStreaming]);

  /* ---------------- COMPLETE VERIFICATION ---------------- */
  const completeVerification = async () => {
    try {
      if (!capturedImageRef.current) {
        addLog("❌ No captured image");
        return;
      }

      addLog("📤 Completing verification...");

      const base64Data = capturedImageRef.current.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteArrays = [];

      for (let i = 0; i < byteCharacters.length; i++) {
        byteArrays.push(byteCharacters.charCodeAt(i));
      }

      const byteArray = new Uint8Array(byteArrays);
      const imageBlob = new Blob([byteArray], { type: 'image/jpeg' });

      const result = await completeFaceVerification(imageBlob, Number(userId));

      if (result.success) {
        addLog("✅ Face verified successfully!");
        speak("Face verified successfully");
        setVerificationSuccess(true);
        setTaskText("Verification Complete! ✅");

        if (sessionId) {
          try {
            await endSession(sessionId);
            addLog("✅ Session ended successfully");
          } catch (err) {
            console.error("Error ending session:", err);
          }
        }
      } else {
        addLog(`❌ ${result.message}`);
        setError(result.message);

        if (result.message === "Face already verified") {
          speak("Your face is already verified");
          setTaskText("Face already verified ✅");
        } else if (result.message === "Face already registered with another account") {
          speak("Face already registered with another account");
          setTaskText("Face already registered with another account ❌");
        } else {
          speak("Face verification failed");
          setTaskText("Verification Failed ❌");
        }
      }

    } catch (error: any) {
      const backendMessage =
        error?.response?.data?.message || error.message || "Face verification failed";

      addLog(`❌ ${backendMessage}`);
      setError(backendMessage);

      if (backendMessage === "Face already verified") {
        speak("Your face is already verified");
        setTaskText("Face already verified ✅");
      }

    } finally {
      setDisabled(false);
    }
  };

  /* ---------------- START LIVENESS ---------------- */
  const startLiveness = async () => {
    if (!cameraReady) {
      setError("Please wait for camera to be ready");
      return;
    }

    setDisabled(true);
    setError(null);
    verificationCompleteRef.current = false;
    setVerificationSuccess(false);
    setTaskText("");
    setActive(false);
    setFaceDetected(false);
    lastTaskRef.current = null;

    try {
      addLog("🔄 Creating session...");
      const sessionData = await createSession(Number(userId));

      if (!sessionData.session_id) {
        throw new Error("Failed to create session");
      }

      addLog(`✅ Session created: ${sessionData.session_id}`);
      setSessionId(sessionData.session_id);

      await new Promise(resolve => setTimeout(resolve, 800));

      if (videoRef.current && canvasRef.current) {
        const ctx = canvasRef.current.getContext("2d")!;
        ctx.drawImage(videoRef.current, 0, 0);
        const frameData = canvasRef.current.toDataURL("image/jpeg", 0.8);
        capturedImageRef.current = frameData;
        addLog("📸 Initial photo captured");
      }

      addLog("🚀 Starting liveness verification...");
      const livenessResult = await startLivenessApi(sessionData.session_id);

      if (livenessResult.success !== false) {
        addLog("✅ Liveness started - follow instructions");
        setTaskText("Position your face in the circle");
        setIsStreaming(true);

        timeoutRef.current = setTimeout(() => {
          handleTimeout();
        }, 30000);
        addLog("⏱️  30 seconds countdown started");
      } else {
        throw new Error(livenessResult.message || "Failed to start liveness");
      }

    } catch (err: any) {
      addLog("❌ Error: " + err.message);
      setError("Error: " + err.message);
      setDisabled(false);
      setIsStreaming(false);
    }
  };

  /* ---------------- CLEANUP ---------------- */
  useEffect(() => {
    getUserMedia();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      window.speechSynthesis.cancel();

      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [getUserMedia]);

  /* ---------------- UI ---------------- */
  return (
    <div style={styles.body}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.headerText}>Please face the phone screen and move your face into the frame</div>
        </div>

        {/* <div style={styles.cameraWrapper}>
          <video ref={videoRef} autoPlay playsInline muted style={styles.video} />
          <div
            style={{
              ...styles.ring,
              borderColor: faceDetected ? "#4CAF50" : active ? "#ec4899" : "#e5e7eb",
            }}
          />

          <div style={styles.faceIndicator}>
            <div style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: faceDetected ? '#4CAF50' : '#FF5252',
            }} />
          </div>

          {isStreaming && (
            <div style={styles.timerContainer}>
              <div style={{
                ...styles.timerBadge,
                backgroundColor: remainingTime <= 10 ? '#FF5252' : '#2563eb',
              }}>
                ⏱️ {remainingTime}s
              </div>
            </div>
          )}
        </div> */}

        <div style={styles.cameraWrapper}>
          <video ref={videoRef} autoPlay playsInline muted style={styles.video} />
          <div
            style={{
              ...styles.ring,
              borderColor: faceDetected ? "#4CAF50" : active ? "#ec4899" : "#e5e7eb",
              boxShadow: faceDetected
                ? "inset 0 0 30px rgba(76, 175, 80, 0.3), 0 0 20px rgba(76, 175, 80, 0.4)"
                : "inset 0 0 20px rgba(0,0,0,0.2)",
            }}
          />

          {/* Face detection indicator */}
          {isStreaming && (
            <div style={styles.faceIndicator}>
              <div style={{
                ...styles.faceIndicatorBadge,
                backgroundColor: faceDetected ? '#4CAF50' : '#FF5252',
              }}>
                {faceDetected ? '✓ Face Detected' : '✗ No Face'}
              </div>
            </div>
          )}

          {/* Countdown Timer */}
          {isStreaming && (
            <div style={styles.timerContainer}>
              <div style={{
                ...styles.timerBadge,
                backgroundColor: remainingTime <= 10 ? '#FF5252' : '#2563eb',
              }}>
                ⏱️ {remainingTime}s
              </div>
            </div>
          )}
        </div>
        {taskText && (
          <div style={styles.taskSection}>
            <div style={styles.task}>{taskText}</div>
            <div style={styles.subText}>Please look straight at the camera and keep still</div>
            <div style={styles.iconContainer}>
              <div style={styles.faceIcon}>👤</div>
            </div>
          </div>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.bottomSection}>
          <button
            disabled={disabled || !cameraReady}
            onClick={startLiveness}
            style={{
              ...styles.button,
              background: disabled || !cameraReady ? "#9ca3af" : verificationSuccess ? "#4CAF50" : "#2563eb",
              cursor: disabled || !cameraReady ? "not-allowed" : "pointer",
            }}
          >
            {verificationSuccess ? "✅ Verified Successfully" : disabled ? "⏳ Processing..." : !cameraReady ? "📷 Initializing Camera..." : "🚀 Start Liveness"}
          </button>
        </div>

        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          style={{ display: "none" }}
        />
      </div>
    </div>
  );
};

const styles: any = {
  body: {
    margin: 0,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto',
    background: "#ffffff",
    color: "#111827",
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    padding: "20px",
    paddingTop: "20px",
  },
  container: {
    width: "100%",
    maxWidth: 480,
    background: "#fff",
  },
  header: {
    padding: "20px",
    textAlign: "center",
  },
  headerText: {
    fontSize: 18,
    fontWeight: 600,
    color: "#111827",
    lineHeight: 1.4,
  },
  cameraWrapper: {
    position: "relative",
    width: "90%",
    maxWidth: 420,
    height: 420,
    margin: "20px auto",
    borderRadius: "50%",
    overflow: "hidden",
    background: "#000",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: "scaleX(-1)",
  },
  ring: {
    position: "absolute",
    inset: 0,
    borderRadius: "50%",
    border: "10px solid",
    transition: "all 0.3s ease",
  },
faceIndicator: {
  position: "absolute",
  top: "8%",          // circle ke top ke paas lane ke liye (adjust kar sakta hai)
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 10,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
},
  timerContainer: {
    position: "absolute",
    bottom: 20,
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "center",
  },
faceIndicatorBadge: {
  padding: "6px 12px",
  // justifyContent: "center",
  alignItems: "center",
  fontSize: 14,
  borderRadius: 20,
  color: "#fff",
}
,
  timerBadge: {
    padding: "10px 20px",
    borderRadius: 25,
    color: "#fff",
    fontSize: 16,
    fontWeight: 700,
    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
    transition: "all 0.3s ease",
  },
  taskSection: {
    marginTop: 30,
    padding: "0 20px",
    textAlign: "center",
  },
  task: {
    fontSize: 22,
    color: "#ef4444",
    fontWeight: 700,
    marginBottom: 16,
  },
  subText: {
    fontSize: 16,
    color: "#f59e0b",
    fontWeight: 600,
    marginBottom: 24,
  },
  iconContainer: {
    display: "flex",
    justifyContent: "center",
    marginTop: 20,
  },
  faceIcon: {
    fontSize: 80,
    opacity: 0.3,
  },
  error: {
    margin: "16px 20px",
    fontSize: 14,
    color: "#dc2626",
    padding: 12,
    background: "#fee2e2",
    borderRadius: 8,
    fontWeight: 500,
    textAlign: "center",
  },
  bottomSection: {
    padding: "0 20px 20px",
    marginTop: 30,
  },
  button: {
    width: "100%",
    padding: 18,
    border: "none",
    borderRadius: 12,
    color: "#fff",
    fontSize: 17,
    fontWeight: 700,
    transition: "all 0.2s",
  },
};

export default LivenessVerification;