import { useEffect, useRef, useState } from "react";
import { addFace, searchFace } from "../utils/api";

/* ---------------- CONFIG ---------------- */
// const BASE_URL = "https://itunitys.com";
const BASE_URL = "http://15.206.8.45"; // production

const LivenessVerification = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<any>(null);

  const capturedImageRef = useRef<Blob | null>(null);

  const [taskText, setTaskText] = useState("");
  const [timer, setTimer] = useState("");
  const [active, setActive] = useState(false);
  const [disabled, setDisabled] = useState(false);

  // 👉 testing purpose
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  /* ---------------- CAMERA ---------------- */
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" } })
      .then(stream => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(err => alert("Camera error: " + err));

    return () => {
      clearInterval(intervalRef.current);
      window.speechSynthesis.cancel();
    };
  }, []);

  /* ---------------- TASK MIRROR (DISPLAY ONLY) ---------------- */
  // const getDisplayTask = (text: string) =>
  //   text.replace(/Look Left/i, "Look Right").replace(/Look Right/i, "Look Left");

  /* ---------------- VOICE ---------------- */
  let femaleVoice: SpeechSynthesisVoice | null = null;

  const loadVoices = () => {
    const voices = window.speechSynthesis.getVoices();
    femaleVoice =
      voices.find(v => v.name.includes("Female")) ||
      voices.find(v => v.name.includes("Google")) ||
      voices.find(v => v.name.includes("Samantha")) ||
      voices.find(v => v.name.includes("Zira")) ||
      voices.find(v => v.lang === "en-US") ||
      voices[0];
  };

  window.speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();

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

  /* ---------------- PHOTO CAPTURE (NON-MIRRORED) ---------------- */
  const capturePhotoOnce = async (): Promise<Blob | null> => {
    if (!canvasRef.current || !videoRef.current) return null;

    const ctx = canvasRef.current.getContext("2d")!;
    ctx.drawImage(videoRef.current, 0, 0, 320, 240);

    return new Promise(resolve => {
      canvasRef.current!.toBlob(blob => {
        if (blob) {
          // 👉 testing preview
          setPreviewUrl(URL.createObjectURL(blob));
          resolve(blob);
        } else {
          resolve(null);
        }
      }, "image/jpeg");
    });
  };

  /* ---------------- START ---------------- */
  const startLiveness = async () => {
    setDisabled(true);

    // 1️⃣ create session
    const sRes = await fetch(`${BASE_URL}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create" }),
    });
    const sData = await sRes.json();

    console.log("Create Session Response:",sData );

    // 2️⃣ capture photo ONCE
    capturedImageRef.current = await capturePhotoOnce();

    // 3️⃣ start liveness
    const lRes = await fetch(`${BASE_URL}/liveness/${sData.session_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });

    console.log("Start Liveness Response:", lRes);
    startFrameLoop(sData.session_id);
  };

  /* ---------------- FRAME LOOP (NON-MIRRORED) ---------------- */
  const startFrameLoop = (sid: string) => {
    intervalRef.current = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current) return;

      const ctx = canvasRef.current.getContext("2d")!;
      ctx.drawImage(videoRef.current, 0, 0, 320, 240);

      const frame = canvasRef.current.toDataURL("image/jpeg");

      const res = await fetch(`${BASE_URL}/process_frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid, frame }),
      });

      const data = await res.json();

      console.log("Process Frame Response:", data);

      /* ---------------- TASK ACTIVE ---------------- */

      if (data.task_session?.active) {
        setActive(true);
        const displayTask = data.task_session.current_task.description;
        setTaskText(displayTask);
        setTimer(
          `Time left: ${Math.floor(
            data.task_session.current_task.time_remaining
          )}s`
        );
        speak(getVoiceText(displayTask));
      }

      /* ---------------- LIVENESS COMPLETE ---------------- */
      if (!data.task_session?.active && data.task_session?.result) {
        clearInterval(intervalRef.current);
        setActive(false);
        setTaskText("");
        setTimer("");
        setDisabled(false);

        if (data.task_session.result.final_result) {
          speak("Liveness verification successful");
          alert("✅ Liveness Successful");

          // 👉 search & add face

          const imageBlob = capturedImageRef.current!;
          const searchRes = await searchFace(imageBlob);

          if (searchRes.matched_user_id) {
            speak("Face already exists");
            alert(`👤 Face already exists: ${searchRes.matched_user_id}`);
          } else {
            const name = `User_${Date.now()}`;
            const addRes = await addFace(name, imageBlob, {
              source: "web_liveness",
              created_at: new Date().toISOString(),
            });
            speak("Face registered successfully");
            alert(`🆕 New User Created: ${addRes.data.person_id}`);
          }
        } else {
          speak("Liveness verification failed");
          alert("❌ Liveness Failed");
        }
      }
    }, 800);
  };

  /* ---------------- UI ---------------- */
  return (
    <div style={styles.body}>
      <div style={styles.container}>
        <div style={styles.title}>Please face the phone screen</div>
        <div style={styles.instruction}>Follow the on-screen instructions</div>

        <div style={styles.cameraWrapper}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            style={styles.video}
          />
          <div
            style={{
              ...styles.ring,
              borderColor: active ? "#ec4899" : "#e5e7eb",
            }}
          />
        </div>

        <div style={styles.task}>{taskText}</div>
        <div style={styles.timer}>{timer}</div>

        <button
          disabled={disabled}
          onClick={startLiveness}
          style={{
            ...styles.button,
            background: disabled ? "#9ca3af" : "#2563eb",
          }}
        >
          Start Liveness
        </button>

        {/* -------- TESTING PREVIEW -------- */}
        {previewUrl && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 12, color: "#6b7280" }}>
              Captured Image (Testing)
            </p>
            <img
              src={previewUrl}
              alt="Captured"
              style={{
                width: 120,
                borderRadius: 8,
                marginTop: 6,
                border: "1px solid #e5e7eb",
              }}
            />
            <br />
            <a
              href={previewUrl}
              download="captured-face.jpg"
              style={{ fontSize: 12, color: "#2563eb" }}
            >
              Download Image
            </a>
          </div>
        )}

        <canvas
          ref={canvasRef}
          width={320}
          height={240}
          style={{ display: "none" }}
        />
      </div>
    </div>
  );
};

/* ---------------- SAME CSS ---------------- */
const styles: any = {
  body: {
    margin: 0,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto',
    background: "#ffffff",
    color: "#111827",
    textAlign: "center",
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  container: { padding: 16 },
  title: { fontSize: 18, marginBottom: 6 },
  instruction: { fontSize: 14, color: "#374151", marginBottom: 14 },
  cameraWrapper: {
    position: "relative",
    width: 300,
    height: 300,
    margin: "0 auto",
    borderRadius: "50%",
    overflow: "hidden",
    background: "#000",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: "scaleX(-1)", // 👈 mirror ONLY for UI
  },
  ring: {
    position: "absolute",
    inset: 8,
    borderRadius: "50%",
    border: "6px solid",
  },
  task: {
    marginTop: 16,
    fontSize: 18,
    color: "#f59e0b",
    fontWeight: 600,
    minHeight: 28,
  },
  timer: { fontSize: 14, color: "#6b7280" },
  button: {
    marginTop: 24,
    width: "90%",
    maxWidth: 320,
    padding: 14,
    border: "none",
    borderRadius: 12,
    color: "#fff",
    fontSize: 16,
    cursor: "pointer",
  },
};

export default LivenessVerification;
