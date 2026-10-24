/**
 * Enterprise Blogger 2.0 — Secure REST API Client
 * 
 * Features:
 * - Automatic credentials: 'include' for HTTP-only cookie transport
 * - Cryptographic CSRF token memory caching and automatic injection on mutating requests
 * - Response interception for automatic CSRF token refresh
 * - Standardized ApiError with status, statusText, and error payload details
 */

let inMemoryCsrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  inMemoryCsrfToken = token;
}

export function getCsrfToken(): string | null {
  return inMemoryCsrfToken;
}

export class ApiError extends Error {
  public status: number;
  public statusText: string;
  public data: any;

  constructor(status: number, statusText: string, data?: any, message?: string) {
    const defaultMsg = data?.message || data?.error || `HTTP ${status} ${statusText}`;
    super(message || defaultMsg);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.data = data;
  }
}

const DEFAULT_API_PREFIX = '/api/v1';

function resolveUrl(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  if (endpoint.startsWith('/api/')) {
    return endpoint;
  }
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${DEFAULT_API_PREFIX}${cleanEndpoint}`;
}

export interface RequestOptions extends RequestInit {
  skipCsrf?: boolean;
}

export async function request<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const url = resolveUrl(endpoint);
  const method = (options.method || 'GET').toUpperCase();
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  const headers = new Headers(options.headers || {});

  // Standard JSON content negotiation
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  // Set JSON Content-Type if body is present and not FormData / Blob
  if (options.body && !(options.body instanceof FormData) && !(options.body instanceof Blob)) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  // Inject cryptographic CSRF token on mutating requests if present
  if (isMutation && !options.skipCsrf && inMemoryCsrfToken) {
    headers.set('x-csrf-token', inMemoryCsrfToken);
  }

  const response = await fetch(url, {
    ...options,
    method,
    headers,
    credentials: 'include', // Mandated for HTTP-only blogger_session cookie
  });

  // Handle empty responses (e.g. 204 No Content)
  if (response.status === 204) {
    return null as unknown as T;
  }

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  let data: any = null;
  if (isJson) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    data = await response.text();
  }

  // Auto-refresh CSRF token if returned in response payload
  if (data && typeof data === 'object' && typeof data.csrfToken === 'string') {
    setCsrfToken(data.csrfToken);
  }

  if (!response.ok) {
    throw new ApiError(response.status, response.statusText, data);
  }

  return data as T;
}

export const api = {
  get: <T = any>(url: string, options?: RequestOptions) => 
    request<T>(url, { ...options, method: 'GET' }),

  post: <T = any>(url: string, body?: any, options?: RequestOptions) =>
    request<T>(url, {
      ...options,
      method: 'POST',
      body: body !== undefined && !(body instanceof FormData) ? JSON.stringify(body) : body,
    }),

  put: <T = any>(url: string, body?: any, options?: RequestOptions) =>
    request<T>(url, {
      ...options,
      method: 'PUT',
      body: body !== undefined && !(body instanceof FormData) ? JSON.stringify(body) : body,
    }),

  patch: <T = any>(url: string, body?: any, options?: RequestOptions) =>
    request<T>(url, {
      ...options,
      method: 'PATCH',
      body: body !== undefined && !(body instanceof FormData) ? JSON.stringify(body) : body,
    }),

  delete: <T = any>(url: string, options?: RequestOptions) =>
    request<T>(url, { ...options, method: 'DELETE' }),
};

export default api;
