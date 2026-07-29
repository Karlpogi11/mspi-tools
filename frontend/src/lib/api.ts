const BASE = import.meta.env.VITE_API_URL || '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'An error occurred');
  }

  return data;
}

export interface User {
  id: number;
  email: string;
  fullName: string;
  roleId: number | null;
  roleName: string | null;
  createdAt?: string;
}

export interface Tool {
  id: number;
  name: string;
  url: string;
  icon: string;
  description: string;
  roleIds?: number[];
}

export interface Role {
  id: number;
  name: string;
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
  login: (email: string, password: string) =>
    request<{ message: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  signup: (email: string, password: string, fullName: string) =>
    request<{ message: string; user: User }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, fullName }),
    }),

  logout: () =>
    request<{ message: string }>('/auth/logout', { method: 'POST' }),

  me: () =>
    request<User>('/auth/me'),

  myTools: () =>
    request<Tool[]>('/my-tools'),

  admin: {
    getUsers: () =>
      request<User[]>('/admin/users'),
    updateUserRole: (userId: number, roleId: number) =>
      request<{ message: string }>(`/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ roleId }),
      }),
    deleteUser: (userId: number) =>
      request<{ message: string }>(`/admin/users/${userId}`, {
        method: 'DELETE',
      }),
    getRoles: () =>
      request<Role[]>('/admin/roles'),
    createRole: (name: string) =>
      request<Role>('/admin/roles', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    deleteRole: (roleId: number) =>
      request<{ message: string }>(`/admin/roles/${roleId}`, {
        method: 'DELETE',
      }),
    getTools: () =>
      request<Tool[]>('/admin/tools'),
    createTool: (tool: Omit<Tool, 'id'>) =>
      request<Tool>('/admin/tools', {
        method: 'POST',
        body: JSON.stringify(tool),
      }),
    updateTool: (id: number, tool: Omit<Tool, 'id'>) =>
      request<Tool>(`/admin/tools/${id}`, {
        method: 'PUT',
        body: JSON.stringify(tool),
      }),
    deleteTool: (id: number) =>
      request<{ message: string }>(`/admin/tools/${id}`, {
        method: 'DELETE',
      }),
  },

  sessions: {
    list: () => request<Session[]>('/pcount/sessions'),
    get: (id: number) => request<Session>(`/pcount/sessions/${id}`),
    create: () => request<Session>('/pcount/sessions', { method: 'POST' }),
    update: (id: number, data: Partial<Session>) =>
      request<Session>(`/pcount/sessions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) =>
      request<{ message: string }>(`/pcount/sessions/${id}`, { method: 'DELETE' }),
  },

  products: {
    list: (sessionId: number, params?: { status?: string; search?: string; sort?: string }) => {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.search) q.set('search', params.search);
      if (params?.sort) q.set('sort', params.sort);
      const qs = q.toString();
      return request<Product[]>(`/pcount/sessions/${sessionId}/products${qs ? `?${qs}` : ''}`);
    },
    get: (sessionId: number, code: string) =>
      request<Product>(`/pcount/sessions/${sessionId}/products/${encodeURIComponent(code)}`),
    update: (sessionId: number, code: string, data: Partial<Product>) =>
      request<Product>(`/pcount/sessions/${sessionId}/products/${encodeURIComponent(code)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    scan: (sessionId: number, product_code: string) =>
      request<ScanResult>(`/pcount/sessions/${sessionId}/scan`, {
        method: 'POST',
        body: JSON.stringify({ product_code }),
      }),
    importSystem: (sessionId: number, products: unknown[], display_columns: string[]) =>
      request<{ message: string; count: number }>(`/pcount/sessions/${sessionId}/import-system`, {
        method: 'POST',
        body: JSON.stringify({ products, display_columns }),
      }),
    importCount: (sessionId: number, products: unknown[]) =>
      request<{ message: string }>(`/pcount/sessions/${sessionId}/import-count`, {
        method: 'POST',
        body: JSON.stringify({ products }),
      }),
  },
};
