import { useEffect, useRef, useState, useCallback } from "react";
import { addFace, createSession, processFrame, searchFace, startLivenessApi } from "../utils/api";

const LivenessVerification = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const taskIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processingFrameRef = useRef(false);
  const lastFrameTimeRef = useRef(0);
  const verificationCompleteRef = useRef(false);
  const capturedImageRef = useRef<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [taskText, setTaskText] = useState("");
  const [timer, setTimer] = useState("");
  const [active, setActive] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [detectionResult, setDetectionResult] = useState<any>(null);

  // Preview for testing
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [faceVerificationResult, setFaceVerificationResult] = useState<any>(null);
  const faceVerificationTriggeredRef = useRef(false);

  const addLog = (msg: string) => {
    console.log(msg);
    setStatusLog(prev => [...prev.slice(-5), `${new Date().toLocaleTimeString()}: ${msg}`]);
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

  let lastSpoken = "";
  const speak = (text: string) => {
    if (!text || lastSpoken === text) return;
    lastSpoken = text;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (femaleVoice) u.voice = femaleVoice;
    u.lang = "en-US";
    u.rate = 0.9;
    u.pitch = 1.2;
    window.speechSynthesis.speak(u);
  };

  const getVoiceText = (task: string) => {
    if (task.includes("Look Right")) return "Please look right";
    if (task.includes("Look Left")) return "Please look left";
    if (task.includes("Look Down")) return "Please look down";
    if (task.includes("Close Eyes")) return "Please close your eyes";
    return "";
  };

  /* ---------------- FACE VERIFICATION ---------------- */
  const performFaceVerification = useCallback(async () => {
    if (!capturedImageRef.current) {
      addLog("❌ No captured image for verification");
      return;
    }

    if (faceVerificationTriggeredRef.current) {
      addLog("⚠️ Face verification already triggered");
      return;
    }

    faceVerificationTriggeredRef.current = true;
    addLog("🔍 Starting face verification...");

    try {
      // Convert base64 to Blob
      const base64Data = capturedImageRef.current.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteArrays = [];
      
      for (let i = 0; i < byteCharacters.length; i++) {
        byteArrays.push(byteCharacters.charCodeAt(i));
      }
      
      const byteArray = new Uint8Array(byteArrays);
      const imageBlob = new Blob([byteArray], { type: 'image/jpeg' });

      // Search for existing face
      addLog("🔎 Searching for existing face...");
      const searchRes = await searchFace(imageBlob);
      
      console.log("📦 Search Face Response:", searchRes);

      if (searchRes.matched_user_id) {
        addLog(`✅ Face found: ${searchRes.matched_user_id}`);
        speak("Face already exists");
        setFaceVerificationResult({
          type: "existing",
          userId: searchRes.matched_user_id,
          confidence: searchRes.confidence,
        });
        // alert(`👤 Welcome back! User: ${searchRes.matched_user_id}`);
      } else {
        // Add new face
        addLog("➕ Adding new face...");
        const name = `User_${Date.now()}`;
        const addRes = await addFace(name, imageBlob, {
          source: "web_liveness",
          created_at: new Date().toISOString(),
        });
        
        console.log("📦 Add Face Response:", addRes);
        
        addLog(`✅ New user created: ${addRes.data.person_id}`);
        speak("Face registered successfully");
        setFaceVerificationResult({
          type: "new",
          userId: addRes.data.person_id,
          name: name,
        });
        alert(`🆕 New User Created: ${addRes.data.person_id}`);
      }
    } catch (error: any) {
      addLog(`❌ Face verification error: ${error.message}`);
      console.error("Face verification error:", error);
      setError("Face verification failed: " + error.message);
    }
  }, []);

  /* ---------------- CAMERA SETUP ---------------- */
  const getUserMedia = useCallback(async (): Promise<boolean> => {
    try {
      addLog("Requesting camera access...");
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

  /* ---------------- FRAME PROCESSING (LIKE NEXT.JS VERSION) ---------------- */
  const captureAndProcessFrame = useCallback(async () => {
    if (!sessionId || !videoRef.current || !canvasRef.current) return;
    if (videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) return;
    if (processingFrameRef.current) return;

    const now = Date.now();
    const timeSinceLastFrame = now - lastFrameTimeRef.current;

    // 50ms throttle like Next.js version
    if (timeSinceLastFrame < 50) return;

    try {
      processingFrameRef.current = true;
      lastFrameTimeRef.current = now;

      const ctx = canvasRef.current.getContext("2d")!;
      ctx.drawImage(videoRef.current, 0, 0);
      const frameData = canvasRef.current.toDataURL("image/jpeg", 0.6);

      const response = await processFrame(sessionId, frameData);

      console.log("📦 Process Frame Response:", response);

      console.log("📦 Process Frame Result:", response);
      if (response.error) {
        if (response.error.includes('Invalid session_id')) {
          setError('Session expired. Restart camera.');
          addLog("⚠️ Session expired");
          setIsStreaming(false);
          setDisabled(false);
        } else {
          setError(response.error);
        }
      } else {
        setDetectionResult(response);
        setError(null);
        
        // 🔥 KEY: Check for task_session in process_frame response
        if (response.task_session?.active && response.task_session?.current_task) {
          const task = response.task_session.current_task;
          setActive(true);
          setTaskText(task.description);
          setTimer(`Time left: ${Math.floor(task.time_remaining || 0)}s`);
          addLog(`📋 ${task.description} (${Math.floor(task.time_remaining || 0)}s)`);
          speak(getVoiceText(task.description));
        }
        
        // 🔥 Check completion in process_frame response
        if (response.task_session && !response.task_session.active && response.task_session.result) {
          addLog("🎉 Verification complete from process_frame!");
          verificationCompleteRef.current = true;
          
          if (taskIntervalRef.current) {
            clearInterval(taskIntervalRef.current);
            taskIntervalRef.current = null;
          }
          
          setActive(false);
          setDisabled(false);
          setIsStreaming(false);
          setTaskText("");
          setTimer("");
          
          if (response.task_session.result.final_result) {
            speak("Liveness verification successful");
            addLog("✅ LIVENESS SUCCESS!");
            
            // 🔥 Perform face verification after successful liveness
            setTimeout(() => {
              performFaceVerification();
            }, 1000);
          } else {
            speak("Liveness verification failed");
            addLog("❌ LIVENESS FAILED");
            alert("❌ Liveness Failed");
          }
        }
      }
    } catch (err: any) {
      console.error("Frame processing error:", err);
    } finally {
      processingFrameRef.current = false;
    }
  }, [sessionId]);

  /* ---------------- CONTINUOUS FRAME LOOP ---------------- */
  const frameLoop = useCallback(() => {
    captureAndProcessFrame();
    if (isStreaming) {
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

  /* ---------------- START LIVENESS ---------------- */
  const startLiveness = async () => {
    setDisabled(true);
    setError(null);
    verificationCompleteRef.current = false;
    faceVerificationTriggeredRef.current = false;
    setFaceVerificationResult(null);
    setStatusLog([]);
    setTaskText("");
    setTimer("");
    setActive(false);

    try {
      // 1. Create session
      addLog("Creating session...");
      const sRes = await createSession();   

      console.log("📦 Session Response:", sRes);

      if (!sRes.success) {
        throw new Error("Failed to create session");
      }

      addLog(`✅ Session: ${sRes.session_id}`);
      setSessionId(sRes.session_id);

      // 2. Get camera access
      if (!(await getUserMedia())) {
        setDisabled(false);
        return;
      }

      // Wait for camera to stabilize
      await new Promise(resolve => setTimeout(resolve, 500));

      // 3. Capture initial image
      if (videoRef.current && canvasRef.current) {
        const ctx = canvasRef.current.getContext("2d")!;
        ctx.drawImage(videoRef.current, 0, 0);
        const frameData = canvasRef.current.toDataURL("image/jpeg", 0.8);
        capturedImageRef.current = frameData;
        setPreviewUrl(frameData);
        addLog("📸 Image captured");
      }

      // 4. Start liveness task
      addLog("Starting liveness...");
      const lRes = await startLivenessApi(sRes.session_id);
      console.log("📦 Liveness Start Response:", lRes);
      
      if (!lRes.success) {
        throw new Error(lRes.message || "Failed to start liveness");
      }

      addLog("✅ Liveness started");
      setIsStreaming(true);
      
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
      if (taskIntervalRef.current) {
        clearInterval(taskIntervalRef.current);
      }
      window.speechSynthesis.cancel();
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
              borderColor: active ? "#ec4899" : "#e5e7eb",
            }}
          />
        </div>

        {taskText && (
          <div style={styles.task}>{taskText}</div>
        )}
        
        {timer && (
          <div style={styles.timer}>{timer}</div>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.bottomSection}>
          {/* Detection Info */}
          {detectionResult && (
            <div style={styles.detectionInfo}>
              <div style={styles.detectionItem}>
                Face: {detectionResult.face_detected ? "✅" : "❌"}
              </div>
              {detectionResult.is_real !== undefined && (
                <div style={styles.detectionItem}>
                  Real: {detectionResult.is_real ? "✅" : "❌"} 
                  ({Math.round((detectionResult.confidence || 0) * 100)}%)
                </div>
              )}
            </div>
          )}

          <button
            disabled={disabled}
            onClick={startLiveness}
            style={{
              ...styles.button,
              background: disabled ? "#9ca3af" : "#2563eb",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {disabled ? "⏳ Processing..." : "🚀 Start Verification"}
          </button>

          {/* Status Log */}
          <div style={styles.logContainer}>
            <div style={styles.logTitle}>📊 Status Log:</div>
            {statusLog.length === 0 ? (
              <div style={styles.logItem}>Ready to start...</div>
            ) : (
              statusLog.map((log, i) => (
                <div key={i} style={styles.logItem}>{log}</div>
              ))
            )}
          </div>

          {previewUrl && (
            <div style={styles.previewSection}>
              <p style={styles.previewTitle}>📸 Captured Image</p>
              <img src={previewUrl} alt="Captured" style={styles.previewImage} />
            </div>
          )}

          {faceVerificationResult && (
            <div style={styles.faceResult}>
              <div style={styles.faceResultTitle}>
                {faceVerificationResult.type === "existing" ? "👤 Existing User" : "🆕 New User"}
              </div>
              <div style={styles.faceResultDetail}>
                User ID: {faceVerificationResult.userId}
              </div>
              {faceVerificationResult.confidence && (
                <div style={styles.faceResultDetail}>
                  Confidence: {Math.round(faceVerificationResult.confidence * 100)}%
                </div>
              )}
            </div>
          )}
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
    transition: "border-color 0.3s",
    boxShadow: "inset 0 0 20px rgba(0,0,0,0.2)",
  },
  task: {
    marginTop: 24,
    fontSize: 22,
    color: "#f59e0b",
    fontWeight: 700,
    minHeight: 30,
    textAlign: "center",
    padding: "0 20px",
  },
  timer: { 
    fontSize: 17, 
    color: "#6b7280", 
    marginTop: 8,
    fontWeight: 600,
    textAlign: "center",
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
  detectionInfo: {
    marginBottom: 16,
    display: "flex",
    gap: 12,
    justifyContent: "center",
    fontSize: 12,
  },
  detectionItem: {
    padding: "6px 12px",
    background: "#f3f4f6",
    borderRadius: 6,
    fontWeight: 600,
    color: "#374151",
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
  },
  logContainer: {
    padding: 14,
    background: "#f9fafb",
    borderRadius: 10,
    maxHeight: 160,
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
  previewSection: {
    marginTop: 16,
    textAlign: "center",
  },
  previewTitle: {
    fontSize: 12,
    color: "#6b7280",
    fontWeight: 600,
    marginBottom: 8,
  },
  previewImage: {
    width: 100,
    borderRadius: 8,
    border: "2px solid #e5e7eb",
  },
  faceResult: {
    marginTop: 16,
    padding: 18,
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    borderRadius: 12,
    color: "#fff",
  },
  faceResultTitle: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 10,
  },
  faceResultDetail: {
    fontSize: 14,
    marginTop: 5,
    opacity: 0.95,
  },
};

export default LivenessVerification;
