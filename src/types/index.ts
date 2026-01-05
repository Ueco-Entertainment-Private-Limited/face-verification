export interface DetectionResult {
  status: string;
  confidence: number;
  is_real: boolean;
  blinks?: number;
  face_detected?: boolean;
  task_session?: TaskStatus;
}

export interface TaskStatus {
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

export interface FaceVerificationResult {
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