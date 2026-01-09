
// API Configuration matching KycScreen endpoints
const API_CONFIG = {
  BASE_URL: "https://dozoapis.com/api",
  HEADERS: {
    "Content-Type": "application/json",
  },
};

// API Functions matching React Native implementation
export const createSession = async () => {
  const response = await fetch(`${API_CONFIG.BASE_URL}/auth/face/session`, {
    method: "POST",
    headers: API_CONFIG.HEADERS,
  });
  const data = await response.json();
  return data.data;
};

export const processFrame = async (sessionId: string, frame: string) => {
  const response = await fetch(`${API_CONFIG.BASE_URL}/auth/face/frame`, {
    method: "POST",
    headers: API_CONFIG.HEADERS,
    body: JSON.stringify({ sessionId, frame }),
  });
  const data = await response.json();
  return data.data;
};

export const startLivenessApi = async (sessionId: string) => {
  const response = await fetch(`${API_CONFIG.BASE_URL}/auth/face/liveness/start`, {
    method: "POST",
    headers: API_CONFIG.HEADERS,
    body: JSON.stringify({ sessionId }),
  });
  return response.json();
};

export const completeFaceVerification = async (sessionId: string, imageBlob: Blob) => {
  const formData = new FormData();
  formData.append('file', imageBlob, 'face.jpg');

  const response = await fetch(`${API_CONFIG.BASE_URL}/auth/face/complete`, {
    method: "POST",
    body: formData,
  });
  return response.json();
};
