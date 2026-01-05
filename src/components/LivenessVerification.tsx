import { useState, useRef, useEffect, useCallback } from 'react';

// Types
interface DetectionResult {
  status: string;
  confidence: number;
  is_real: boolean;
  blinks?: number;
  face_detected?: boolean;
  task_session?: TaskStatus;
}

interface TaskStatus {
  active?: boolean;
  completed_tasks?: number;
  total_tasks?: number;
  current_task?: {
    description: string;
    task: string;
    time_remaining: number;
    index: number;
    total: number;
  };
  result?: {
    final_result?: boolean;
    passed?: boolean;
    completed?: number;
    total?: number;
    success_rate?: number;
  };
}

interface FaceVerificationResult {
  success: boolean;
  matchFound: boolean;
  isNewUser: boolean;
  data: {
    vectorId: string;
    confidence: number;
    userName: string;
    user?: any;
  };
  tokens?: {
    accessToken: string;
    refreshToken: string;
  };
}

const BASE_URL = "https://itunitys.com";
const API_KEY = "dz_live_2024_secure_api_key_xyz789";

const LivenessVerification: React.FC = () => {
  // State management
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cameraAccess, setCameraAccess] = useState<'not-granted' | 'granted' | 'denied'>('not-granted');
  const [detectionResult, setDetectionResult] = useState<DetectionResult | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTaskActive, setIsTaskActive] = useState(false);
  const [verificationComplete, setVerificationComplete] = useState(false);
  const [faceVerificationResult, setFaceVerificationResult] = useState<FaceVerificationResult | null>(null);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processingFrameRef = useRef(false);
  const verificationTriggeredRef = useRef(false);
  const capturedImageRef = useRef<string | null>(null);
  const speechSynthRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Text-to-Speech
  const speak = useCallback((text: string) => {
    if (!text) return;
    
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = voices.find(v => 
      v.name.includes("Female") || 
      v.name.includes("Samantha") || 
      v.name.includes("Zira") ||
      v.lang === "en-US"
    ) || voices[0];
    
    if (femaleVoice) utterance.voice = femaleVoice;
    utterance.lang = "en-US";
    utterance.rate = 0.9;
    utterance.pitch = 1.2;
    utterance.volume = 1;
    
    speechSynthRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, []);

  // Get display text (mirror left/right for user)
  const getDisplayTask = (text: string): string => {
    if (!text) return "";
    return text
      .replace(/Look Left/i, "Look Right")
      .replace(/Look Right/i, "Look Left");
  };

  const getVoiceText = (displayTask: string): string => {
    if (!displayTask) return "";
    if (displayTask.includes("Look Right")) return "Please look right";
    if (displayTask.includes("Look Left")) return "Please look left";
    if (displayTask.includes("Look Down")) return "Please look down";
    if (displayTask.includes("Close Eyes")) return "Please close your eyes";
    return "";
  };

  // Session management
  const createSession = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${BASE_URL}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create" })
      });
      const data = await response.json();
      
      if (data.success && data.session_id) {
        setSessionId(data.session_id);
        console.log("✅ Session created:", data.session_id);
        return true;
      }
      setError(data.message || "Failed to create session");
      return false;
    } catch (err: any) {
      setError("Failed to create session: " + err.message);
      return false;
    }
  }, []);

  const endSession = useCallback(async () => {
    if (sessionId) {
      try {
        await fetch(`${BASE_URL}/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "end", session_id: sessionId })
        });
        console.log("✅ Session ended");
      } catch (err) {
        console.error("Error ending session:", err);
      }
      setSessionId(null);
    }
  }, [sessionId]);

  // Camera management
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false
      });

      mediaStreamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        await new Promise<void>((resolve, reject) => {
          videoRef.current!.onloadedmetadata = () => {
            if (canvasRef.current && videoRef.current) {
              canvasRef.current.width = videoRef.current.videoWidth;
              canvasRef.current.height = videoRef.current.videoHeight;
            }
            setCameraAccess('granted');
            resolve();
          };
          videoRef.current!.onerror = reject;
          setTimeout(() => reject(new Error('Camera timeout')), 10000);
        });
      }

      return true;
    } catch (err: any) {
      setCameraAccess('denied');
      setError("Camera access denied. Please grant permissions.");
      return false;
    }
  }, []);

  const stopCamera = useCallback(async () => {
    console.log("🛑 Stopping camera...");
    
    // Clear intervals
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (statusIntervalRef.current) {
      clearInterval(statusIntervalRef.current);
      statusIntervalRef.current = null;
    }
    
    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    setIsStreaming(false);
    setCameraAccess('not-granted');
    await endSession();
  }, [endSession]);

  // Frame processing
  const captureAndProcessFrame = useCallback(async () => {
    if (!sessionId || !videoRef.current || !canvasRef.current || processingFrameRef.current) {
      return;
    }

    if (videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
      return;
    }

    try {
      processingFrameRef.current = true;
      
      const ctx = canvasRef.current.getContext('2d')!;
      // Mirror the image for natural selfie view
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(videoRef.current, -canvasRef.current.width, 0, canvasRef.current.width, canvasRef.current.height);
      ctx.restore();
      
      const frameData = canvasRef.current.toDataURL('image/jpeg', 0.6);

      const response = await fetch(`${BASE_URL}/process_frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, frame: frameData })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const result = await response.json();
      
      if (result.error) {
        setError(result.error);
      } else {
        setDetectionResult(result);
        setError(null);
      }
    } catch (err: any) {
      console.error("Frame processing error:", err);
      setError("Frame processing failed");
    } finally {
      processingFrameRef.current = false;
    }
  }, [sessionId]);

  // Task status polling
  const updateTaskStatus = useCallback(async () => {
    if (!sessionId || verificationTriggeredRef.current) return;

    try {
      const response = await fetch(`${BASE_URL}/liveness/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      const status = data.session_status || data;
      
      setTaskStatus(status);

      // Check if verification is complete
      if (status && !status.active && status.result) {
        console.log("✅ Verification complete!");
        
        // Stop polling immediately
        if (statusIntervalRef.current) {
          clearInterval(statusIntervalRef.current);
          statusIntervalRef.current = null;
        }
        
        setIsTaskActive(false);
        setVerificationComplete(true);

        // If passed, trigger face verification
        if (status.result.final_result && !verificationTriggeredRef.current) {
          verificationTriggeredRef.current = true;
          speak("Liveness verification successful");
          await performFaceVerification();
        } else if (!status.result.final_result) {
          speak("Liveness verification failed");
        }
      }
    } catch (err: any) {
      console.error("Status update error:", err);
    }
  }, [sessionId, speak]);

  // Face verification
  const performFaceVerification = useCallback(async () => {
    if (!capturedImageRef.current) {
      console.error("❌ No captured image available");
      return;
    }

    console.log("🔍 Starting face verification...");
    speak("Processing face verification");

    try {
      // Convert base64 to blob
      const response = await fetch(capturedImageRef.current);
      const blob = await response.blob();

      const formData = new FormData();
      formData.append('action', 'search');
      formData.append('image', blob);

      // Search for existing face
      const searchRes = await fetch(`${BASE_URL}/faces`, {
        method: "POST",
        headers: { "X-API-Key": API_KEY },
        body: formData
      });

      const searchData = await searchRes.json();
      console.log("🔍 Face search result:", searchData);

      if (searchData.matched_user_id) {
        // Existing user
        speak("Face already exists");
        setFaceVerificationResult({
          success: true,
          matchFound: true,
          isNewUser: false,
          data: {
            vectorId: searchData.matched_user_id,
            confidence: searchData.confidence || 0,
            userName: searchData.user_name || "Existing User"
          }
        });
      } else {
        // New user - register
        const userName = `User_${Math.floor(100000 + Math.random() * 900000)}`;
        const addFormData = new FormData();
        addFormData.append('action', 'add');
        addFormData.append('name', userName);
        addFormData.append('metadata', JSON.stringify({
          source: 'web_liveness',
          created_at: new Date().toISOString(),
          platform: 'browser'
        }));
        addFormData.append('image', blob);

        const addRes = await fetch(`${BASE_URL}/faces`, {
          method: "POST",
          headers: { "X-API-Key": API_KEY },
          body: addFormData
        });

        const addData = await addRes.json();
        console.log("✅ New user created:", addData);
        
        speak("Face registered successfully");
        setFaceVerificationResult({
          success: true,
          matchFound: false,
          isNewUser: true,
          data: {
            vectorId: addData.data?.person_id || "",
            confidence: 1.0,
            userName: userName
          }
        });
      }
    } catch (err: any) {
      console.error("❌ Face verification error:", err);
      setError("Face verification failed: " + err.message);
      speak("Face verification failed");
    }
  }, [speak]);

  // Start liveness task
  const startLivenessTask = useCallback(async () => {
    if (!sessionId) {
      setError("No active session. Start camera first.");
      return;
    }

    // Capture image before starting
    if (videoRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')!;
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(videoRef.current, -canvasRef.current.width, 0, canvasRef.current.width, canvasRef.current.height);
      ctx.restore();
      capturedImageRef.current = canvasRef.current.toDataURL('image/jpeg', 0.8);
      console.log("📸 Image captured");
    }

    try {
      verificationTriggeredRef.current = false;
      setVerificationComplete(false);
      setFaceVerificationResult(null);

      const response = await fetch(`${BASE_URL}/liveness/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" })
      });

      const data = await response.json();
      
      if (data.success) {
        setTaskStatus(data.session_status);
        setIsTaskActive(true);
        
        // Start status polling
        statusIntervalRef.current = setInterval(updateTaskStatus, 500);
        console.log("🟢 Status polling started");
      } else {
        setError(data.message || "Failed to start liveness task");
      }
    } catch (err: any) {
      setError("Error starting liveness task: " + err.message);
    }
  }, [sessionId, updateTaskStatus]);

  // Initialize camera and session
  const handleStart = useCallback(async () => {
    setError(null);
    
    const sessionCreated = await createSession();
    if (!sessionCreated) return;

    const cameraStarted = await startCamera();
    if (!cameraStarted) {
      await endSession();
      return;
    }

    setIsStreaming(true);
    
    // Start frame processing
    frameIntervalRef.current = setInterval(captureAndProcessFrame, 800);
  }, [createSession, startCamera, endSession, captureAndProcessFrame]);

  // Reset and try again
  const handleReset = useCallback(async () => {
    verificationTriggeredRef.current = false;
    capturedImageRef.current = null;
    setTaskStatus(null);
    setVerificationComplete(false);
    setFaceVerificationResult(null);
    setIsTaskActive(false);
    setError(null);
    
    if (sessionId) {
      await fetch(`${BASE_URL}/liveness/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" })
      });
    }
  }, [sessionId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      window.speechSynthesis.cancel();
    };
  }, []);

  // Update UI when task status changes
  useEffect(() => {
    if (taskStatus?.active && taskStatus.current_task) {
      const displayTask = getDisplayTask(taskStatus.current_task.description);
      const voiceText = getVoiceText(displayTask);
      if (voiceText) speak(voiceText);
    }
  }, [taskStatus?.current_task?.description, speak]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">
            Active Liveness Verification
          </h1>
          <p className="text-sm text-gray-600">
            {!isStreaming 
              ? "Click start to begin verification"
              : isTaskActive 
                ? "Follow the on-screen instructions"
                : "Camera active - click 'Start Verification' when ready"}
          </p>
        </div>

        {/* Camera Container */}
        <div className="relative w-80 h-80 mx-auto mb-6 rounded-full overflow-hidden bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />
          <div 
            className={`absolute inset-2 rounded-full border-4 transition-colors ${
              isTaskActive ? 'border-pink-500' : 'border-gray-300'
            }`}
          />
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Task Display */}
        {isTaskActive && taskStatus?.current_task && (
          <div className="text-center mb-4">
            <p className="text-xl font-semibold text-amber-500 min-h-[2rem]">
              {getDisplayTask(taskStatus.current_task.description)}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Time left: {Math.floor(taskStatus.current_task.time_remaining)}s
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Task {taskStatus.current_task.index} of {taskStatus.current_task.total}
            </p>
          </div>
        )}

        {/* Results Display */}
        {verificationComplete && taskStatus?.result && (
          <div className={`p-4 rounded-lg mb-4 ${
            taskStatus.result.final_result ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
          }`}>
            <p className={`text-center font-semibold ${
              taskStatus.result.final_result ? 'text-green-700' : 'text-red-700'
            }`}>
              {taskStatus.result.final_result ? '✅ Liveness Passed' : '❌ Liveness Failed'}
            </p>
            {faceVerificationResult && (
              <div className="mt-3 pt-3 border-t border-gray-300">
                <p className="text-sm text-gray-700 text-center">
                  {faceVerificationResult.isNewUser 
                    ? `🆕 New User: ${faceVerificationResult.data.userName}`
                    : `👤 Existing User: ${faceVerificationResult.data.userName}`
                  }
                </p>
                <p className="text-xs text-gray-500 text-center mt-1">
                  Confidence: {(faceVerificationResult.data.confidence * 100).toFixed(1)}%
                </p>
              </div>
            )}
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
            <p className="text-sm text-red-700 text-center">{error}</p>
          </div>
        )}

        {/* Control Buttons */}
        <div className="space-y-3">
          {!isStreaming ? (
            <button
              onClick={handleStart}
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
            >
              Start Camera
            </button>
          ) : !isTaskActive && !verificationComplete ? (
            <>
              <button
                onClick={startLivenessTask}
                className="w-full py-3 px-4 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition-colors"
              >
                Start Verification
              </button>
              <button
                onClick={stopCamera}
                className="w-full py-3 px-4 bg-gray-500 text-white rounded-xl font-medium hover:bg-gray-600 transition-colors"
              >
                Stop Camera
              </button>
            </>
          ) : verificationComplete ? (
            <button
              onClick={handleReset}
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
            >
              Try Again
            </button>
          ) : null}
        </div>

        {/* Status Indicators */}
        <div className="mt-6 flex justify-center gap-4 text-xs text-gray-500">
          <span>Camera: {cameraAccess}</span>
          {sessionId && <span>Session: Active</span>}
          {isTaskActive && <span className="text-green-600 font-medium">● Verifying</span>}
        </div>
      </div>
    </div>
  );
};

export default LivenessVerification;