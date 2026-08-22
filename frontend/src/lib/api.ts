import type { InventoryRow } from './consumables';

const BASE = import.meta.env.VITE_API_URL || '/api';
const GET_CACHE_TTL = 30_000;
const getCache = new Map<string, { data: unknown; updatedAt: number }>();
const getInFlight = new Map<string, Promise<unknown>>();

export interface ApiRequestError extends Error {
  status?: number;
  retryAfter?: number;
  data?: unknown;
}

function retryAfterSeconds(res: Response): number | undefined {
  const value = res.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds));
  const deadline = Date.parse(value);
  return Number.isNaN(deadline) ? undefined : Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
}

function responseError(message: string, res: Response, data?: unknown): ApiRequestError {
  const error = new Error(message) as ApiRequestError;
  error.status = res.status;
  error.retryAfter = retryAfterSeconds(res);
  error.data = data;
  return error;
}

function proxySafePdfName(name: string, index: number): string {
  const stem = name
    .replace(/\.pdf$/i, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[_\s.-]+|[_\s.-]+$/g, '')
    .slice(0, 120) || 'document';
  return `${String(index + 1).padStart(2, '0')}-${stem}.pdf`;
}

function base64UrlUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function readJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    if (res.status === 429) {
      throw responseError('Too many failed login attempts. Please wait before trying again.', res);
    }
    throw responseError('The server is unavailable right now. Please try again in a moment.', res);
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
      if (attempt === 0 && res.ok) {
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      throw err;
    }

    if (!res.ok) {
      throw responseError(((data as { error?: string } | null)?.error) || 'An error occurred', res, data);
    }

    return data;
  }
  throw new Error('The server is unavailable right now. Please try again in a moment.');
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    getCache.clear();
    return fetchJson<T>(path, options);
  }

  const cached = getCache.get(path);
  if (cached) {
    if (Date.now() - cached.updatedAt >= GET_CACHE_TTL && !getInFlight.has(path)) {
      const refresh = fetchJson<T>(path, options)
        .then((data) => {
          getCache.set(path, { data, updatedAt: Date.now() });
          return data;
        })
        .finally(() => getInFlight.delete(path));
      getInFlight.set(path, refresh);
    }
    return cached.data as T;
  }

  const pending = getInFlight.get(path) as Promise<T> | undefined;
  if (pending) return pending;

  const requestPromise = fetchJson<T>(path, options)
    .then((data) => {
      getCache.set(path, { data, updatedAt: Date.now() });
      return data;
    })
    .finally(() => getInFlight.delete(path));
  getInFlight.set(path, requestPromise);
  return requestPromise;
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
  renamedFile?: string;
  pageCount?: number;
  deepAnalysis?: boolean;
  viewUrl?: string;
  retryUrl?: string;
}

export interface ExtractDownload {
  url: string;
  name: string;
  count: number;
}

export interface PdfDiagnostic {
  id: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  message: string;
  file?: string;
  runId?: string;
  batchId?: string;
}

export interface ExtractBatch {
  results: ExtractResult[];
  download: ExtractDownload | null;
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

export interface ApplecareStatus { connected: boolean; email: string | null; lastSyncedAt: string | null }
export interface ApplecareSite { id: number; ship_to: string; site_name: string; active: number }
export interface ApplecarePackingList {
  id: number; gmail_message_id: string; subject: string; sender: string; received_by: string | null; ship_to: string;
  site_id: number | null; site_name?: string | null; packing_date: string; packing_time: string;
  received_at: string | null; attachment_name: string; status: string; total_quantity: number; email_url: string;
}
export interface ApplecareItem { id: number; part_number: string; description: string; po_no: string | null; serial_number: string; quantity: number; raw_text: string | null }
export interface ApplecarePackingListDetail extends ApplecarePackingList { items: ApplecareItem[]; raw_text?: string | null }

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

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

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
    resetPassword: (userId: number, newPassword: string) =>
      request<{ message: string }>(`/admin/users/${userId}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ newPassword }),
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

  applecare: {
    status: () => request<ApplecareStatus>('/applecare/status'),
    connectUrl: () => `${BASE}/applecare/gmail/connect`,
    disconnect: () => request<{ message: string }>('/applecare/gmail/disconnect', { method: 'DELETE' }),
    sync: () => request<{ imported: number }>('/applecare/sync', { method: 'POST' }),
    lists: () => request<ApplecarePackingList[]>('/applecare/lists'),
    detail: (id: number) => request<ApplecarePackingListDetail>(`/applecare/lists/${id}`),
    sites: () => request<ApplecareSite[]>('/applecare/sites'),
    createSite: (shipTo: string, siteName: string) => request<ApplecareSite>('/applecare/sites', { method: 'POST', body: JSON.stringify({ shipTo, siteName }) }),
    updateSite: (id: number, siteName: string) => request<ApplecareSite>(`/applecare/sites/${id}`, { method: 'PUT', body: JSON.stringify({ siteName }) }),
    attachmentUrl: (id: number) => `${BASE}/applecare/lists/${id}/attachment`,
    downloadAttachment: async (id: number, filename: string) => {
      const res = await fetch(`${BASE}/applecare/lists/${id}/attachment`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || 'Attachment is unavailable');
      }
      await saveBlob(await res.blob(), filename || 'packing-list');
    },
  },

  pdfExtractor: {
    extract: async (files: File[]): Promise<ExtractBatch> => {
      const form = new FormData();
      for (const f of files) form.append('files', f);
      const res = await fetch(`${BASE}/pdf-extractor/extract`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const data = await readJson<{ results?: ExtractResult[]; download?: ExtractDownload | null; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to process files');
      }
      return { results: data.results ?? [], download: data.download ?? null };
    },
    extractStream: async (
      files: File[],
      onProgress: (completed: number, total: number, file: string) => void,
      signal?: AbortSignal,
      runId?: string,
      batchId?: string,
      batchNumber?: number,
    ): Promise<ExtractBatch> => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const form = new FormData();
        files.forEach((file, index) => {
          // Hosting WAF rules parse multipart filenames before Express. Keep
          // that header conservative and restore the real name in the backend.
          form.append('files', file, proxySafePdfName(file.name, index));
          form.append('originalNames', base64UrlUtf8(file.name));
        });
        if (runId) form.append('runId', runId);
        if (batchId) form.append('batchId', batchId);
        if (batchNumber !== undefined) form.append('batchNumber', String(batchNumber));
        let res: Response;
        try {
          res = await fetch(`${BASE}/pdf-extractor/extract-stream`, {
            method: 'POST', credentials: 'include', body: form, signal,
          });
        } catch (err) {
          if (signal?.aborted || attempt === 2) throw err;
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => null);
          const error = responseError(data?.error || 'Failed to process files', res, data);
          if (![502, 503, 504].includes(res.status) || attempt === 2) throw error;
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        try {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let completedBatch: ExtractBatch | null = null;
          while (true) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.trim()) continue;
              const event = JSON.parse(line);
              if (event.type === 'progress') onProgress(event.completed, event.total, event.file);
              if (event.type === 'error') {
                const error = new Error(event.error || 'Failed to process files') as Error & { retryable?: boolean };
                error.retryable = false;
                throw error;
              }
              if (event.type === 'complete') completedBatch = { results: event.results ?? [], download: event.download ?? null };
            }
            if (done) break;
          }
          if (!completedBatch) throw new Error('Processing connection ended before results were ready');
          return completedBatch;
        } catch (err) {
          if (signal?.aborted || (err as { retryable?: boolean }).retryable === false || attempt === 2) throw err;
          lastError = err;
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
      throw lastError instanceof Error ? lastError : new Error('Failed to connect to the PDF extractor');
    },
    finalizeRun: async (runId: string): Promise<ExtractDownload | null> => {
      const res = await fetch(`${BASE}/pdf-extractor/finalize-run`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      const data = await readJson<{ download?: ExtractDownload | null; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || 'Failed to prepare download');
      return data.download ?? null;
    },
    downloadUrl: (path: string) => `${BASE}${path.replace(/^\/api/, '')}`,
    retry: async (url: string): Promise<{ result: ExtractResult; download: ExtractDownload | null }> => {
      const res = await fetch(`${BASE}${url.replace(/^\/api/, '')}`, {
        method: 'POST', credentials: 'include',
      });
      const data = await readJson<{ result?: ExtractResult; download?: ExtractDownload | null; error?: string }>(res);
      if (!res.ok || !data.result) throw new Error(data.error || 'Failed to retry file');
      return { result: data.result, download: data.download ?? null };
    },
    log: () =>
      request<AwbLogRow[]>('/pdf-extractor/log'),
    diagnostics: () =>
      request<PdfDiagnostic[]>('/pdf-extractor/diagnostics'),
    clearDiagnostics: async () => {
      const res = await fetch(`${BASE}/pdf-extractor/diagnostics`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to clear temporary diagnostics');
    },
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
