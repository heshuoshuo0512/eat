const DEFAULT_API_BASE_URL = import.meta.env.MODE === 'development'
  ? 'http://127.0.0.1:8787'
  : 'http://101.34.216.33';
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL;

export const DEMO_STUDENT = {
  username: '演示学生',
  password: 'student123'
};
export const DEMO_ADMIN = {
  username: 'admin',
  password: 'admin123'
};
