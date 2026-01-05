export const API_CONFIG = {
  BASE_URL: "https://itunitys.com",
  API_KEY: "dz_live_2024_secure_api_key_xyz789",
};

export const createSession = async () => {
  const response = await fetch(`${API_CONFIG.BASE_URL}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create" })
  });
  return response.json();
};

export const endSession = async (sessionId: string) => {
  const response = await fetch(`${API_CONFIG.BASE_URL}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "end", session_id: sessionId })
  });
  return response.json();
};

export const processFrame = async (sessionId: string, frame: string) => {
  const response = await fetch(`${API_CONFIG.BASE_URL}/process_frame`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, frame })
  });
  return response.json();
};

export const startLiveness = async (sessionId: string) => {
  const response = await fetch(`${API_CONFIG.BASE_URL}/liveness/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start" })
  });
  return response.json();
};

export const getLivenessStatus = async (sessionId: string) => {
  const response = await fetch(`${API_CONFIG.BASE_URL}/liveness/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "status" })
  });
  return response.json();
};

export const resetLiveness = async (sessionId: string) => {
  const response = await fetch(`${API_CONFIG.BASE_URL}/liveness/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reset" })
  });
  return response.json();
};

export const searchFace = async (imageBlob: Blob) => {
  const formData = new FormData();
  formData.append('action', 'search');
  formData.append('image', imageBlob);

  const response = await fetch(`${API_CONFIG.BASE_URL}/faces`, {
    method: "POST",
    headers: { "X-API-Key": API_CONFIG.API_KEY },
    body: formData
  });
  return response.json();
};

export const addFace = async (userName: string, imageBlob: Blob, metadata: any) => {
  const formData = new FormData();
  formData.append('action', 'add');
  formData.append('name', userName);
  formData.append('metadata', JSON.stringify(metadata));
  formData.append('image', imageBlob);

  const response = await fetch(`${API_CONFIG.BASE_URL}/faces`, {
    method: "POST",
    headers: { "X-API-Key": API_CONFIG.API_KEY },
    body: formData
  });
  return response.json();
};