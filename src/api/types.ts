export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  message?: string;
  errorCode?: string;
};

