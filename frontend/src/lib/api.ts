import type { InventoryRow } from './consumables';

const BASE = import.meta.env.VITE_API_URL || '/api';

export async function readJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    throw new Error('The server is unavailable right now. Please try again in a moment.');
  }
  return res.json() as Promise<T>;
}

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options?.headers },
        ...options,
      });
    } catch {
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      throw new Error('The server is unavailable right now. Please try again in a moment.');
    }

    let data: T;
    try {
      data = await readJson<T>(res);
    } catch (err) {
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      throw err;
    }

    if (!res.ok) {
      const err = new Error(((data as { error?: string } | null)?.error) || 'An error occurred') as Error & { data?: unknown };
      err.data = data;
      throw err;
    }

    return data;
  }
  throw new Error('The server is unavailable right now. Please try again in a moment.');
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  return fetchJson<T>(path, options);
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
  created_by: number | null;
  join_code: string | null;
  submitted_at: string | null;
  submitted_by: number | null;
  is_owner?: boolean;
  joined?: boolean;
  owner_email?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PcountAdminSession extends Session {
  member_count: number;
}

export interface PcountAdminDetail {
  session: Session;
  products: Product[];
  creator: { id: number; email: string } | null;
  submitter: { id: number; email: string } | null;
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

export interface ReformatColumn {
  name: string;
  source: string;
  constant: string;
}

export interface ConsumableMaster {
  id: number;
  part_number: string;
  description: string;
  category: string;
  expires: string;
  unit: string;
}

export interface ConsumableMasterPayload {
  part_number: string;
  description: string;
  category?: string;
  expires?: string;
  unit?: string;
}

export interface ReformatTemplate {
  id: number;
  name: string;
  header_row: number;
  columns: ReformatColumn[];
  removed_columns: ReformatColumn[];
  created_by: number;
  is_owner: boolean;
  owner_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReformatUser {
  id: number;
  email: string;
  full_name: string;
}

export interface ExtractFieldValues {
  HAWB: string;
  InvoiceReference: string;
  InvoiceTotalAmount: string;
  DeliveryDate: string;
  TotalQty: string;
}

export type ExtractStatus = 'ok' | 'duplicate' | 'error' | 'permit';

export interface ExtractResult {
  file: string;
  status: ExtractStatus;
  method?: string;
  reasons?: string[];
  fields?: ExtractFieldValues;
  dest?: string;
  monthFolder?: string;
  permit?: boolean;
}

export interface AwbLogRow {
  id: number;
  hawb: string;
  invoice_reference: string;
  invoice_total_amount: string;
  delivery_date: string;
  total_qty: string;
  received_date: string;
  original_filename: string;
  month_folder: string;
  status: string;
  date_logged: string | null;
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
    search: (q: string) =>
      request<Session[]>(`/pcount/sessions/search?q=${encodeURIComponent(q)}`),
    join: (code: string) =>
      request<Session>('/pcount/sessions/join', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),
    submit: (id: number) =>
      request<{ message: string; session: Session }>(`/pcount/sessions/${id}/submit`, {
        method: 'POST',
      }),
    reopen: (id: number) =>
      request<{ message: string; session: Session }>(`/pcount/sessions/${id}/reopen`, {
        method: 'POST',
      }),
    update: (id: number, data: Partial<Session>) =>
      request<Session>(`/pcount/sessions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) =>
      request<{ message: string }>(`/pcount/sessions/${id}`, { method: 'DELETE' }),
  },

  pcountAdmin: {
    listSessions: () => request<PcountAdminSession[]>('/pcount/admin/sessions'),
    getSession: (id: number) =>
      request<PcountAdminDetail>(`/pcount/admin/sessions/${id}`),
    exportUrl: (id: number) => `/api/pcount/admin/sessions/${id}/export`,
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

  reformat: {
    listTemplates: () =>
      request<{ owned: ReformatTemplate[]; shared: ReformatTemplate[] }>('/reformat/templates'),
    getTemplate: (id: number) =>
      request<ReformatTemplate>(`/reformat/templates/${id}`),
    createTemplate: (data: { name: string; header_row: number; columns: ReformatColumn[]; removed_columns: ReformatColumn[] }) =>
      request<ReformatTemplate>('/reformat/templates', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateTemplate: (id: number, data: { name?: string; header_row?: number; columns?: ReformatColumn[]; removed_columns?: ReformatColumn[] }) =>
      request<ReformatTemplate>(`/reformat/templates/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deleteTemplate: (id: number) =>
      request<{ message: string }>(`/reformat/templates/${id}`, { method: 'DELETE' }),
    listShares: (id: number) =>
      request<ReformatUser[]>(`/reformat/templates/${id}/shares`),
    share: (id: number, email: string) =>
      request<ReformatUser>(`/reformat/templates/${id}/share`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    unshare: (id: number, userId: number) =>
      request<{ message: string }>(`/reformat/templates/${id}/share/${userId}`, {
        method: 'DELETE',
      }),
    searchUsers: (q: string) =>
      request<ReformatUser[]>(`/reformat/users/search?q=${encodeURIComponent(q)}`),
  },

  consumables: {
    listMaster: () =>
      request<ConsumableMaster[]>('/consumables/master'),
    createMaster: (data: ConsumableMasterPayload) =>
      request<ConsumableMaster>('/consumables/master', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateMaster: (id: number, data: ConsumableMasterPayload) =>
      request<ConsumableMaster>(`/consumables/master/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deleteMaster: (id: number) =>
      request<{ message: string }>(`/consumables/master/${id}`, { method: 'DELETE' }),
    importMaster: (items: ConsumableMasterPayload[]) =>
      request<{ added: number; updated: number; count: number }>('/consumables/master/import', {
        method: 'POST',
        body: JSON.stringify({ items }),
      }),
    downloadTemplate: async () => {
      const res = await fetch(`${BASE}/consumables/template`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to download template');
      }
      await saveBlob(await res.blob(), 'consumables-template.xlsx');
    },
    exportLabels: async (labels: { line1: string; line2: string }[]) => {
      const res = await fetch(`${BASE}/consumables/export-labels`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labels }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to build labels file');
      }
      await saveBlob(await res.blob(), 'consumable-labels.xlsx');
    },
    exportInventory: async (rows: InventoryRow[]) => {
      const res = await fetch(`${BASE}/consumables/export-inventory`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to build inventory file');
      }
      await saveBlob(await res.blob(), 'consumable-inventory.xlsx');
    },
  },

  pdfExtractor: {
    extract: async (files: File[]): Promise<ExtractResult[]> => {
      const form = new FormData();
      for (const f of files) form.append('files', f);
      const res = await fetch(`${BASE}/pdf-extractor/extract`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const data = await readJson<{ results?: ExtractResult[]; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to process files');
      }
      return data.results ?? [];
    },
    log: () =>
      request<AwbLogRow[]>('/pdf-extractor/log'),
  },
};

export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
