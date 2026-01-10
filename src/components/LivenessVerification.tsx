import { useCallback, useRef, useState,useEffect } from "react";
import { processFrame, completeFaceVerification, createSession, startLivenessApi } from "../utils/api";

const LivenessVerification = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const processingFrameRef = useRef(false);
  const lastFrameTimeRef = useRef(0);
  const verificationCompleteRef = useRef(false);
  const capturedImageRef = useRef<string | null>(null);
  const lastTaskRef = useRef<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [taskText, setTaskText] = useState("");
  const [active, setActive] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [faceDetected, setFaceDetected] = useState(false);
  const [verificationSuccess, setVerificationSuccess] = useState(false);

  const addLog = (msg: string) => {
    console.log(msg);
    setStatusLog(prev => [...prev.slice(-8), `${new Date().toLocaleTimeString()}: ${msg}`]);
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
      return false;
    }
  }, []);

  /* ---------------- HANDLE FRAME RESPONSE (matching React Native logic) ---------------- */
  const handleFrameResponse = (res: any) => {
    if (res.face_detected === false) {
      setFaceDetected(false);
      return;
    }

    setFaceDetected(true);

    // Check for active task
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

    // Check for completion
    if (res.task_session && !res.task_session.active && res.task_session.result) {
      verificationCompleteRef.current = true;
      setActive(false);
      setIsStreaming(false);
      
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

    // Throttle to ~20 FPS (50ms between frames)
    if (timeSinceLastFrame < 50) return;

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

  /* ---------------- COMPLETE VERIFICATION ---------------- */
  const completeVerification = async () => {
    try {
      if (!capturedImageRef.current) {
        addLog("❌ No captured image");
        return;
      }

      addLog("📤 Completing verification...");

      // Convert base64 to Blob
      const base64Data = capturedImageRef.current.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteArrays = [];
      
      for (let i = 0; i < byteCharacters.length; i++) {
        byteArrays.push(byteCharacters.charCodeAt(i));
      }
      
      const byteArray = new Uint8Array(byteArrays);
      const imageBlob = new Blob([byteArray], { type: 'image/jpeg' });

      const result = await completeFaceVerification(imageBlob);

      if (result.success) {
        addLog("✅ Face verified successfully!");
        speak("Face verified successfully");
        setVerificationSuccess(true);
        setTaskText("Verification Complete! ✅");
      } else {
        addLog("❌ Face verification failed");
        setError("Face verification failed");
      }
    } catch (error: any) {
      addLog("❌ Error: " + error.message);
      setError("Face verification failed");
    } finally {
      setDisabled(false);
    }
  };

  /* ---------------- START LIVENESS ---------------- */
  const startLiveness = async () => {
    setDisabled(true);
    setError(null);
    verificationCompleteRef.current = false;
    setVerificationSuccess(false);
    setStatusLog([]);
    setTaskText("");
    setActive(false);
    setFaceDetected(false);
    lastTaskRef.current = null;

    try {
      // 1. Create session
      addLog("🔄 Creating session...");
      const sessionData = await createSession();

      if (!sessionData.session_id) {
        throw new Error("Failed to create session");
      }

      addLog(`✅ Session created: ${sessionData.session_id}`);
      setSessionId(sessionData.session_id);

      // 2. Get camera access
      if (!(await getUserMedia())) {
        setDisabled(false);
        return;
      }

      // Wait for camera to stabilize
      await new Promise(resolve => setTimeout(resolve, 500));

      // 3. Capture initial image (like React Native takePhoto)
      if (videoRef.current && canvasRef.current) {
        const ctx = canvasRef.current.getContext("2d")!;
        ctx.drawImage(videoRef.current, 0, 0);
        const frameData = canvasRef.current.toDataURL("image/jpeg", 0.8);
        capturedImageRef.current = frameData;
        addLog("📸 Initial photo captured");
      }

      // 4. Start liveness task
      addLog("🚀 Starting liveness verification...");
      const livenessResult = await startLivenessApi(sessionData.session_id);
      
      if (livenessResult.success !== false) {
        addLog("✅ Liveness started - follow instructions");
        setTaskText("Position your face in the circle");
        setIsStreaming(true);
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
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      window.speechSynthesis.cancel();
      
      // Stop camera stream
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  /* ---------------- UI ---------------- */
  return (
    <div style={styles.body}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.title}>🎭 Face Liveness Verification</div>
          <div style={styles.instruction}>Follow the on-screen instructions</div>
        </div>

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
        </div>

        {taskText && (
          <div style={styles.taskSection}>
            <div style={styles.taskBadge}>INSTRUCTION</div>
            <div style={styles.task}>{taskText}</div>
          </div>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.bottomSection}>
          <button
            disabled={disabled}
            onClick={startLiveness}
            style={{
              ...styles.button,
              background: disabled ? "#9ca3af" : verificationSuccess ? "#4CAF50" : "#2563eb",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {verificationSuccess ? "✅ Verified Successfully" : disabled ? "⏳ Processing..." : "🚀 Start Verification"}
          </button>

          {/* Status Log */}
          <div style={styles.logContainer}>
            <div style={styles.logTitle}>📊 Status Log:</div>
            {statusLog.length === 0 ? (
              <div style={styles.logItem}>Ready to start verification...</div>
            ) : (
              statusLog.map((log, i) => (
                <div key={i} style={styles.logItem}>{log}</div>
              ))
            )}
          </div>
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
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    color: "#111827",
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    padding: "20px",
    paddingTop: "40px",
  },
  container: { 
    width: "100%",
    maxWidth: 480,
    background: "#fff",
    borderRadius: 24,
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    overflow: "hidden",
  },
  header: {
    padding: "24px 20px",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    color: "#fff",
  },
  title: { 
    fontSize: 24, 
    marginBottom: 8, 
    fontWeight: 700,
  },
  instruction: { 
    fontSize: 15, 
    opacity: 0.95,
  },
  cameraWrapper: {
    position: "relative",
    width: 360,
    height: 360,
    margin: "30px auto",
    borderRadius: "50%",
    overflow: "hidden",
    background: "#000",
    boxShadow: "0 12px 24px rgba(0,0,0,0.3)",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: "scaleX(-1)",
  },
  ring: {
    position: "absolute",
    inset: 8,
    borderRadius: "50%",
    border: "8px solid",
    transition: "all 0.3s ease",
  },
  faceIndicator: {
    position: "absolute",
    top: 16,
    left: 0,
    right: 0,
    display: "flex",
    justifyContent: "center",
  },
  faceIndicatorBadge: {
    padding: "8px 16px",
    borderRadius: 20,
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
  },
  taskSection: {
    marginTop: 24,
    padding: "0 20px",
    textAlign: "center",
  },
  taskBadge: {
    display: "inline-block",
    backgroundColor: "rgba(74, 144, 226, 0.2)",
    color: "#2563eb",
    padding: "4px 12px",
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1,
    marginBottom: 12,
  },
  task: {
    fontSize: 20,
    color: "#f59e0b",
    fontWeight: 700,
    minHeight: 30,
  },
  error: {
    margin: "12px 20px",
    fontSize: 13,
    color: "#dc2626",
    padding: 12,
    background: "#fee2e2",
    borderRadius: 8,
    fontWeight: 500,
  },
  bottomSection: {
    padding: "0 20px 20px",
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
    marginBottom: 16,
    marginTop: 16,
  },
  logContainer: {
    padding: 14,
    background: "#f9fafb",
    borderRadius: 10,
    maxHeight: 180,
    overflow: "auto",
    fontSize: 10,
    textAlign: "left",
    border: "1px solid #e5e7eb",
  },
  logTitle: {
    fontWeight: 700,
    marginBottom: 8,
    color: "#374151",
    fontSize: 11,
  },
  logItem: {
    marginBottom: 4,
    color: "#4b5563",
    fontFamily: "monospace",
    lineHeight: 1.5,
  },
};

export default LivenessVerification;