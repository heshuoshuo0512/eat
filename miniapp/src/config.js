const DEFAULT_API_BASE_URL = import.meta.env.MODE === 'development'
  ? 'http://127.0.0.1:8787'
  : 'https://stueat.com';
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL;
export const COLLECTOR_URL = import.meta.env.VITE_COLLECTOR_URL || (import.meta.env.MODE === 'development' ? 'http://127.0.0.1:5174' : '');
