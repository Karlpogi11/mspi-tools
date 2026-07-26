const BASE = '/api/pcount';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export interface Session {
  id: number;
  name: string;
  status: string;
  sort_desc: number;
  progress: number;
  total: number;
  checked: number;
  display_columns: string[];
  online_count?: number;
  active_scanner_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: number;
  session_id: number;
  product_code: string;
  description: string;
  category: string;
  system_qty: number;
  counted_qty: number;
  adjusted_qty: number | null;
  status: string;
  notes: string | null;
  extra: Record<string, string>;
}

export interface ScanResult extends Product {
  match: boolean;
}

export const api = {
  sessions: {
    list: () => request<Session[]>('/sessions'),
    get: (id: number) => request<Session>(`/sessions/${id}`),
    create: () => request<Session>('/sessions', { method: 'POST' }),
    update: (id: number, data: Partial<Session>) =>
      request<Session>(`/sessions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) =>
      request<{ message: string }>(`/sessions/${id}`, { method: 'DELETE' }),
  },

  products: {
    list: (sessionId: number, params?: { status?: string; search?: string; sort?: string }) => {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.search) q.set('search', params.search);
      if (params?.sort) q.set('sort', params.sort);
      const qs = q.toString();
      return request<Product[]>(`/sessions/${sessionId}/products${qs ? `?${qs}` : ''}`);
    },
    get: (sessionId: number, code: string) =>
      request<Product>(`/sessions/${sessionId}/products/${encodeURIComponent(code)}`),
    update: (sessionId: number, code: string, data: Partial<Product>) =>
      request<Product>(`/sessions/${sessionId}/products/${encodeURIComponent(code)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    scan: (sessionId: number, product_code: string) =>
      request<ScanResult>(`/sessions/${sessionId}/scan`, {
        method: 'POST',
        body: JSON.stringify({ product_code }),
      }),
    importSystem: (sessionId: number, products: unknown[], display_columns: string[]) =>
      request<{ message: string; count: number }>(`/sessions/${sessionId}/import-system`, {
        method: 'POST',
        body: JSON.stringify({ products, display_columns }),
      }),
    importCount: (sessionId: number, products: unknown[]) =>
      request<{ message: string }>(`/sessions/${sessionId}/import-count`, {
        method: 'POST',
        body: JSON.stringify({ products }),
      }),
  },
};
