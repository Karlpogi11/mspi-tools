import type { InventoryRow } from './consumables';

const BASE = import.meta.env.VITE_API_URL || '/api';
const GET_CACHE_TTL = 30_000;
const getCache = new Map<string, { data: unknown; updatedAt: number }>();
const getInFlight = new Map<string, Promise<unknown>>();
export const AUTH_UNAUTHORIZED_EVENT = 'mspi:auth-unauthorized';
export const SESSION_EXPIRED_STORAGE_KEY = 'mspi-session-expired';

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

function notifyUnauthorized(path: string): void {
  if (typeof window === 'undefined' || window.location.pathname === '/login' || path === '/auth/me' || path.startsWith('/auth/login') || path.startsWith('/auth/signup')) return;
  getCache.clear();
  getInFlight.clear();
  window.sessionStorage.setItem(SESSION_EXPIRED_STORAGE_KEY, '1');
  window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
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
    if (res.status === 403) throw responseError('Access to this resource was blocked by the hosting server. Please try again shortly.', res);
    if (res.status === 429) throw responseError('Too many requests. Please wait before trying again.', res);
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
        ...options,
        headers: { 'Content-Type': 'application/json', ...options?.headers },
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
      if (res.status === 401) notifyUnauthorized(path);
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

async function requestFresh<T>(path: string, options?: RequestInit): Promise<T> {
  return fetchJson<T>(path, options);
}

export interface User {
  id: number;
  email: string;
  fullName: string;
  roleId: number | null;
  roleName: string | null;
  isSuperAdmin?: boolean;
  createdAt?: string;
}

export interface Tool {
  id: number;
  name: string;
  url: string;
  icon: string;
  description: string;
  roleIds?: number[];
  roleNames?: string[];
  canAccess?: boolean;
}

export interface Role {
  id: number;
  name: string;
}

export interface StorageRule { family: 'IOS' | 'Mac'; status: string; numbers: number[] }
export interface StorageEmployee { id: number; employeeNumber: string; fullName: string; active: number; createdAt?: string; updatedAt?: string }
export interface StorageUnit { id: number; ar_number: string; family: string; status: string; cabinet_number: number; state: 'in' | 'out'; checked_in_at: string | null; checked_out_at: string | null; current_employee_name?: string | null }
export interface StorageMovement { id: number; action: 'IN' | 'OUT'; family: string; status: string; cabinet_number: number | null; occurred_at: string; employee_number: string; full_name: string }
export interface StorageRecentMovement extends StorageMovement { ar_number: string }

export interface PartsSite { id: number; code: string; name: string; active: number }
export interface PartsMasterItem { id: number; part_number: string; description: string; eee_code: string | null; substitute_part: string | null; serialized: string }
export interface PartsUnit { id: number; part_number: string; description?: string | null; serial: string | null; quantity: number; status: string; reference: string | null; occurred_date: string | null; stocked_in_at?: string | null; stocked_out_at?: string | null; site_code: string; site_name?: string }
export interface PartsStockSummary { total: number; units: number; out_total: number; parts: number }
export interface PartsMovement { id: number; type: string; part_number: string; serial: string | null; occurred_date: string; reference: string | null; quantity: number; created_at: string; site_code: string }
export interface PartsSheetStatus { connected: boolean; email: string | null; spreadsheetId: string; spreadsheetName: string; sheetName: string; pendingSync: number }

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

export interface PcountComparisonRow {
  product_code: string;
  description: string;
  brand: string;
  previous_category: string;
  current_category: string;
  category_changed: boolean;
  previous_count: number;
  current_count: number;
  difference: number;
  previous_status: string | null;
  current_status: string | null;
  change: 'added' | 'removed' | 'changed' | 'unchanged';
}

export interface PcountComparison {
  currentSession: Session;
  previousSession: Session;
  products: PcountComparisonRow[];
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
export interface FrontlineSpreadsheet { id: string; name: string; modifiedTime?: string }
export interface FrontlineSheet { title: string; sheetId: number }
export interface FrontlineSource { id: number; spreadsheet_id: string; spreadsheet_name: string; selected_sheets: string[]; write_sheet_name: string | null; last_synced_at: string | null; last_sync_status: string; last_sync_error: string | null }
export interface FrontlineReport {
  total: number;
  averageAht: number;
  csos: Array<[string, number]>;
  types: Array<[string, number]>;
  divisions: Array<[string, number]>;
  records: Array<{ id: number; source_sheet: string; source_row: number; occurred_date: string | null; aht_minutes: number | null; transaction_type: string; product_division: string; ar_number: string; serial_number: string; device_model: string; cso: string; issue: string; endorsement_id?: number | null; endorsement_status?: string | null; endorsed_engineer_name?: string | null; endorsed_at?: string | null }>;
}
export interface FrontlineStatus { connected: boolean; sourceName: string | null; lastSyncedAt: string | null; syncStatus: string; syncError: string | null }
export interface FrontlineSerialHistory { id: number; source_sheet: string; occurred_date: string | null; ar_number: string; serial_number: string; device_model: string; product_division: string; cso: string; transaction_type: string; issue: string }
export type FrontlineOptionKey = 'product_division' | 'transaction_type' | 'cso';
export interface FrontlineOption { id: number; label: string; sort_order: number }
export type FrontlineOptionLists = Record<FrontlineOptionKey, FrontlineOption[]>;
export interface FrontlineAccessRequest { id: number; user_id: number; email?: string; full_name?: string; reason: string; status: 'pending' | 'approved' | 'rejected'; created_at: string; reviewed_at: string | null; access_scope?: 'all' | 'cso' | null; cso_name?: string | null }
export interface EndorsementEngineer { id: number; user_id: number | null; full_name: string; email?: string; assignment_count: number; status?: 'active' | 'left'; joined_at?: string; last_assigned_at?: string | null }
export const ENDORSEMENT_DIVISIONS = ['iOS/ACCS', 'MacBook', 'iMac'] as const;
export type EndorsementDivision = typeof ENDORSEMENT_DIVISIONS[number];
export interface EndorsementQueue { division: EndorsementDivision; countPeriod: 'day' | 'month'; engineers: EndorsementEngineer[]; nextEngineer: EndorsementEngineer | null; token: string }
export interface EndorsementQueues { date: string; queues: EndorsementQueue[]; roster: EndorsementEngineer[]; engineers: EndorsementEngineer[]; nextEngineer: EndorsementEngineer | null; skips: Array<{ id: number; division: EndorsementDivision; engineer_name: string; reason: string; created_at: string }> }
export interface EndorsementAssignmentInput { arNumber: string; frontlineRecordId?: number; sourceSheet?: string; sourceRow?: number; serialNumber?: string; deviceModel?: string; division?: EndorsementDivision; queueToken?: string; engineerName?: string }
export interface EndorsementPreview { date: string; record: { arNumber: string; frontlineRecordId: number; deviceModel: string; issue: string; productDivision: EndorsementDivision }; queue: EndorsementQueue }
export interface EndorsementNotification { id: number; ar_number: string; device_model: string; issue: string; engineer_name: string; cso_user_id: number | null; created_at: string }
export interface EngineerDashboard { date: string; availability: { user_id: number; status: 'active' | 'left'; joined_at: string; left_at: string | null; assignment_count: number } | null; totals: { total: number; pending: number }; divisions: Array<{ product_division: string; total: number }>; endorsements: Array<{ id: number; ar_number: string; serial_number?: string | null; device_model: string; issue: string; product_division: string; status: string; created_at: string; engineer_name: string; cso_name: string | null }> }
export interface EngineerCalendar { month: string; divisions: string[]; engineerOrder: Record<string, string[]>; columns: Array<{ division: string; engineer: string; total: number }>; totals: Record<string, number>; days: Array<{ date: string; day: string; counts: Record<string, Record<string, Array<{ id: number; ar_number: string; serial_number?: string | null; device_model: string; issue: string; product_division: string; status: string; engineer_name: string; created_at: string; manual_count?: number; details?: string; is_manual?: boolean }>>>; endorsements: Array<{ id: number; ar_number: string; serial_number?: string | null; device_model: string; issue: string; product_division: string; status: string; engineer_name: string; created_at: string }> }> }
export interface ApplecareSite { id: number; ship_to: string; site_name: string; active: number }
export interface ApplecarePackingList {
  id: number; gmail_message_id: string; subject: string; sender: string; received_by: string | null; ship_to: string;
  site_id: number | null; site_name?: string | null; packing_date: string; packing_time: string;
  received_at: string | null; attachment_name: string; status: string; total_quantity: number; email_url: string;
}
export interface ApplecareItem { id: number; part_number: string; description: string; po_no: string | null; serial_number: string; quantity: number; raw_text: string | null }
export interface ApplecarePackingListDetail extends ApplecarePackingList { items: ApplecareItem[]; raw_text?: string | null }

let partsSiteToken = '';
export function setPartsSiteToken(token: string) {
  partsSiteToken = token;
}
/** Verified Parts site code for this session (e.g. PODIUM), or null. Display-only. */
export function getPartsSiteCode(): string | null {
  try {
    const payload = partsSiteToken.split('.')[0];
    if (!payload) return null;
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { code?: string; exp?: number };
    if (!data.code || !(data.exp! > Date.now())) return null;
    return data.code;
  } catch {
    return null;
  }
}
function siteHeaders(): Record<string, string> {
  return partsSiteToken ? { 'x-site-token': partsSiteToken } : {};
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
    frontlineGoogleStatus: () => request<{ connected: boolean; email: string | null }>('/frontline/google/status'),
    frontlineGoogleConnectUrl: () => `${BASE}/frontline/google/connect`,
    frontlineGoogleDisconnect: () => request<{ message: string }>('/frontline/google/disconnect', { method: 'DELETE' }),
    frontlineSheets: (spreadsheetId: string) => request<{ title: string; sheets: FrontlineSheet[] }>(`/frontline/spreadsheets/${encodeURIComponent(spreadsheetId)}/sheets`),
    frontlineSource: () => request<FrontlineSource | null>('/frontline/source'),
    saveFrontlineSource: (spreadsheetId: string, spreadsheetName: string, sheets: string[], writeSheetName: string) => request<{ message: string }>('/frontline/source', { method: 'POST', body: JSON.stringify({ spreadsheetId, spreadsheetName, sheets, writeSheetName }) }),
    syncFrontline: () => request<{ imported: number }>('/frontline/sync', { method: 'POST' }),
    getFrontlineAccessRequests: () => request<FrontlineAccessRequest[]>('/admin/frontline/access-requests'),
    grantFrontlineAccess: (email: string, scope: 'all' | 'cso', csoName?: string) => request<{ message: string }>('/admin/frontline/access', { method: 'POST', body: JSON.stringify({ email, scope, csoName }) }),
    updateFrontlineAccessRequest: (id: number, status: 'approved' | 'rejected', scope?: 'all' | 'cso', csoName?: string) => request<{ message: string }>(`/admin/frontline/access-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status, scope, csoName }) }),
    getStorageEmployees: () => request<StorageEmployee[]>('/storage-locator/employees'),
    addStorageEmployee: (employeeNumber: string, fullName: string) => request<StorageEmployee>('/storage-locator/employees', { method: 'POST', body: JSON.stringify({ employeeNumber, fullName }) }),
    updateStorageEmployee: (id: number, payload: { employeeNumber: string; fullName: string; active: boolean }) => request<{ message: string }>(`/storage-locator/employees/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    deleteStorageEmployee: (id: number) => request<{ message: string }>(`/storage-locator/employees/${id}`, { method: 'DELETE' }),
    getPartsSites: () => request<{ sites: PartsSite[] }>('/parts/sites'),
    addPartsSite: (code: string, name: string) => request<PartsSite>('/parts/sites', { method: 'POST', body: JSON.stringify({ code, name }) }),
    updatePartsSite: (id: number, payload: { code: string; name: string; active: boolean }) => request<{ message: string }>(`/parts/sites/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    deletePartsSite: (id: number) => request<{ message: string }>(`/parts/sites/${id}`, { method: 'DELETE' }),
    getPartsMaster: (q?: string) => request<{ items: PartsMasterItem[] }>(`/parts/master${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    addPartsMaster: (payload: { part_number: string; description: string; eee_code?: string | null; substitute_part?: string | null; serialized?: string }) => request<PartsMasterItem>('/parts/master', { method: 'POST', body: JSON.stringify(payload) }),
    updatePartsMaster: (id: number, payload: { part_number: string; description: string; eee_code?: string | null; substitute_part?: string | null; serialized?: string }) => request<{ message: string }>(`/parts/master/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    deletePartsMaster: (id: number) => request<{ message: string }>(`/parts/master/${id}`, { method: 'DELETE' }),
    importPartsMaster: (items: { part_number: string; description: string; eee_code?: string | null; substitute_part?: string | null; serialized?: string }[]) => request<{ added: number; updated: number; count: number }>('/parts/master/import', { method: 'POST', body: JSON.stringify({ items }) }),
  },

    frontline: {
    access: () => request<{ allowed: boolean; scope: 'all' | 'cso' | null; cso: string | null; request: FrontlineAccessRequest | null }>('/frontline/access'),
    requestAccess: (reason: string) => request<{ message: string }>('/frontline/access-request', { method: 'POST', body: JSON.stringify({ reason }) }),
    status: () => request<FrontlineStatus>('/frontline/status'),
    sync: () => request<{ imported: number; skipped?: boolean }>('/frontline/sync', { method: 'POST' }),
    options: () => request<FrontlineOptionLists>('/frontline/options'),
    addOption: (listKey: FrontlineOptionKey, label: string) => request<FrontlineOption>('/frontline/options', { method: 'POST', body: JSON.stringify({ listKey, label }) }),
    updateOption: (id: number, label: string) => request<{ message: string; id: number; label: string }>(`/frontline/options/${id}`, { method: 'PATCH', body: JSON.stringify({ label }) }),
    checkEntry: (payload: { ar: string; serial: string; transactionType: string; date: string; issue: string }) => requestFresh<{ duplicate: boolean; matches: Array<{ id: number; ar_number: string; serial_number: string; transaction_type: string; occurred_date: string }> }>(`/frontline/entry-check?${new URLSearchParams(payload).toString()}`),
    lookup: (payload: { ar?: string; serial?: string }) => requestFresh<FrontlineReport['records']>(`/frontline/lookup?${new URLSearchParams(payload).toString()}`),
    serialHistory: (serial: string) => requestFresh<FrontlineSerialHistory[]>(`/frontline/serial-history?serial=${encodeURIComponent(serial)}`),
    deviceModels: () => request<string[]>('/frontline/device-models'),
    report: (params: { start?: string; end?: string; ar?: string; cso?: string[]; type?: string[]; division?: string[] } = {}) => {
      const queryParams = new URLSearchParams();
      if (params.start) queryParams.set('start', params.start);
      if (params.end) queryParams.set('end', params.end);
      if (params.ar) queryParams.set('ar', params.ar);
      for (const value of params.cso || []) queryParams.append('cso', value);
      for (const value of params.type || []) queryParams.append('type', value);
      for (const value of params.division || []) queryParams.append('division', value);
      const query = queryParams.toString();
      return requestFresh<FrontlineReport>(`/frontline/report${query ? `?${query}` : ''}`);
    },
    writeSchema: (sheet: string) => request<{ sheet: string; headers: string[] }>(`/frontline/write-schema?sheet=${encodeURIComponent(sheet)}`),
    writeEntry: (payload: { sheet: string; headers: string[]; values: string[] }) => request<{ message: string }>('/frontline/write-entry', { method: 'POST', body: JSON.stringify(payload) }),
  },

  endorsements: {
    join: () => request<{ message: string }>('/endorsements/availability/join', { method: 'POST' }),
    leave: () => request<{ message: string }>('/endorsements/availability/leave', { method: 'POST' }),
    skip: (division: EndorsementDivision, reason: string, queueToken: string) => request<{ message: string }>('/endorsements/availability/skip', { method: 'POST', body: JSON.stringify({ division, reason, queueToken }) }),
    passNext: (division: EndorsementDivision, reason: string, queueToken: string) => request<{ message: string }>('/endorsements/availability/pass-next', { method: 'POST', body: JSON.stringify({ division, reason, queueToken }) }),
    reorder: (division: EndorsementDivision, engineerIds: number[], queueToken: string) => request<{ message: string }>('/endorsements/availability/order', { method: 'PUT', body: JSON.stringify({ division, engineerIds, queueToken }) }),
    addEngineer: (name: string) => request<{ message: string }>('/endorsements/availability/add', { method: 'POST', body: JSON.stringify({ name }) }),
    removeEngineer: (id: number) => request<{ message: string }>('/endorsements/availability/remove', { method: 'POST', body: JSON.stringify({ id }) }),
    schedule: (engineerName?: string) => requestFresh<{ restDays: string[] }>(`/endorsements/availability/schedule${engineerName ? `?engineerName=${encodeURIComponent(engineerName)}` : ''}`),
    saveSchedule: (restDays: string[], engineerName?: string) => request<{ message: string; restDays: string[] }>('/endorsements/availability/schedule', { method: 'PUT', body: JSON.stringify({ restDays, engineerName }) }),
    available: (division?: EndorsementDivision) => requestFresh<EndorsementQueues>(`/endorsements/available${division ? `?division=${encodeURIComponent(division)}` : ''}`),
    preview: (payload: EndorsementAssignmentInput) => request<EndorsementPreview>('/endorsements/preview', { method: 'POST', body: JSON.stringify(payload) }),
    notifications: (afterId = 0) => requestFresh<EndorsementNotification[]>(`/endorsements/notifications?afterId=${afterId}`),
    create: (payload: EndorsementAssignmentInput) => request<{ message: string; endorsementId: number; engineer: { userId: number | null; name: string }; record: { arNumber: string; deviceModel: string; issue: string; productDivision: string } }>('/endorsements', { method: 'POST', body: JSON.stringify(payload) }),
    updateDeviceModel: (id: number, deviceModel: string) => request<{ message: string; deviceModel: string }>(`/endorsements/${id}`, { method: 'PATCH', body: JSON.stringify({ deviceModel }) }),
    updateEngineer: (id: number, engineerName: string) => request<{ message: string; engineer: string }>(`/endorsements/${id}/engineer`, { method: 'PATCH', body: JSON.stringify({ engineerName }) }),
    delete: (id: number) => request<{ message: string }>(`/endorsements/${id}`, { method: 'DELETE' }),
    roster: () => request<{ roster: EndorsementEngineer[] }>('/endorsements/roster'),
    addRosterEngineer: (name: string) => request<{ message: string; name: string }>('/endorsements/roster', { method: 'POST', body: JSON.stringify({ name }) }),
    updateRosterEngineer: (id: number, name: string) => request<{ message: string; name: string }>(`/endorsements/roster/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    deleteRosterEngineer: (id: number) => request<{ message: string }>(`/endorsements/roster/${id}`, { method: 'DELETE' }),
    dashboard: (engineerUserId?: number) => request<EngineerDashboard>(`/endorsements/dashboard${engineerUserId ? `?engineerUserId=${engineerUserId}` : ''}`),
    dashboardFresh: (engineerUserId?: number) => requestFresh<EngineerDashboard>(`/endorsements/dashboard${engineerUserId ? `?engineerUserId=${engineerUserId}` : ''}`),
    calendar: (month: string) => request<EngineerCalendar>(`/endorsements/calendar?month=${encodeURIComponent(month)}`),
    calendarFresh: (month: string) => requestFresh<EngineerCalendar>(`/endorsements/calendar?month=${encodeURIComponent(month)}`),
    saveCalendarOrder: (month: string, division: string, engineerOrder: string[]) => request<{ message: string }>('/endorsements/calendar-order', { method: 'PUT', body: JSON.stringify({ month, division, engineerOrder }) }),
    saveCalendarEntry: (payload: { date: string; division: string; engineer: string; count: number; details?: string; arNumbers?: string[] }) => request<{ message: string }>('/endorsements/calendar-entry', { method: 'PUT', body: JSON.stringify(payload) }),
    deleteCalendarEntry: (payload: { date: string; division: string; engineer: string }) => request<{ message: string }>('/endorsements/calendar-entry', { method: 'DELETE', body: JSON.stringify(payload) }),
    passEndorsement: (id: number) => request<{ message: string; engineer: string }>(`/endorsements/${id}/pass`, { method: 'POST' }),
    cancelEndorsement: (id: number) => request<{ message: string }>(`/endorsements/${id}/cancel`, { method: 'POST' }),
  },

  storageLocator: {
    rules: () => request<{ rules: StorageRule[] }>('/storage-locator/rules'),
    overview: () => request<{ occupied: StorageUnit[]; rules: StorageRule[] }>('/storage-locator/overview'),
    recentHistory: () => request<{ history: StorageRecentMovement[] }>('/storage-locator/recent-history'),
    verifyEmployee: (employeeNumber: string) => request<{ employee: StorageEmployee }>(`/storage-locator/employees/verify?employeeNumber=${encodeURIComponent(employeeNumber)}`),
    lookup: (arNumber: string) => request<{ unit: StorageUnit | null; history: StorageMovement[] }>(`/storage-locator/units/${encodeURIComponent(arNumber)}`),
    checkIn: (payload: { employeeNumber: string; arNumber: string; family: string; status: string; cabinetNumber: number }) => request<{ message: string }>('/storage-locator/units/in', { method: 'POST', body: JSON.stringify(payload) }),
    checkOut: (payload: { employeeNumber: string; arNumber: string }) => request<{ message: string }>('/storage-locator/units/out', { method: 'POST', body: JSON.stringify(payload) }),
  },

  parts: {
    verifySite: (code: string) => request<{ site: PartsSite; siteToken: string }>(`/parts/sites/verify?code=${encodeURIComponent(code)}`),
    master: (q?: string, limit?: number) => request<{ items: PartsMasterItem[] }>(`/parts/master${q || limit ? `?${new URLSearchParams({ ...(q ? { q } : {}), ...(limit ? { limit: String(limit) } : {}) }).toString()}` : ''}`),
    stock: (siteCode: string, q?: string, limit?: number) => requestFresh<{ stock: PartsUnit[]; summary: PartsStockSummary }>(`/parts/stock?siteCode=${encodeURIComponent(siteCode)}${q ? `&q=${encodeURIComponent(q)}` : ''}${limit ? `&limit=${limit}` : ''}`, { headers: siteHeaders() }),
    partUnits: (siteCode: string, partNumber: string) => requestFresh<{ units: PartsUnit[] }>(`/parts/part-units?siteCode=${encodeURIComponent(siteCode)}&partNumber=${encodeURIComponent(partNumber)}`, { headers: siteHeaders() }),
    stockParts: (siteCode: string) => request<{ parts: { part_number: string; description: string | null; date: string | null; serials: number }[] }>(`/parts/stock/parts?siteCode=${encodeURIComponent(siteCode)}`, { headers: siteHeaders() }),
    lookup: (serial: string, siteCode: string) => requestFresh<{ unit: PartsUnit | null; history: PartsMovement[] }>(`/parts/lookup?serial=${encodeURIComponent(serial)}&siteCode=${encodeURIComponent(siteCode)}`, { headers: siteHeaders() }),
    resolve: (params: { serial?: string; partNumber?: string; eee?: string; siteCode?: string }) => {
      const query = new URLSearchParams();
      if (params.serial) query.set('serial', params.serial);
      if (params.partNumber) query.set('partNumber', params.partNumber);
      if (params.eee) query.set('eee', params.eee);
      if (params.siteCode) query.set('siteCode', params.siteCode);
      return requestFresh<{ part: PartsMasterItem | null; unit: PartsUnit | null }>(`/parts/resolve?${query.toString()}`, { headers: siteHeaders() });
    },
    recent: (siteCode: string) => request<{ history: PartsMovement[] }>(`/parts/recent?siteCode=${encodeURIComponent(siteCode)}`, { headers: siteHeaders() }),
    stockIn: (payload: { siteCode: string; partNumber: string; serial?: string; serials?: string[]; eee?: string; quantity?: number; occurredDate?: string }) => request<{ message: string; imported?: number; failed?: number; errors?: { serial: string; error: string }[] }>('/parts/stock/in', { method: 'POST', headers: siteHeaders(), body: JSON.stringify(payload) }),
    ensureMaster: (payload: { part_number: string; description: string; serialized?: string }) => request<{ item: PartsMasterItem; created: boolean }>('/parts/master/ensure', { method: 'POST', headers: siteHeaders(), body: JSON.stringify(payload) }),
    stockOut: (payload: { siteCode: string; serial?: string; partNumber?: string; quantity?: number; reference: string; occurredDate?: string }) => request<{ message: string }>('/parts/stock/out', { method: 'POST', headers: siteHeaders(), body: JSON.stringify(payload) }),
    importIn: (siteCode: string, rows: { date: string; partNumber: string; serial: string }[]) => request<{ imported: number; failed: number; errors: { row: number; error: string }[] }>('/parts/import/in', { method: 'POST', headers: siteHeaders(), body: JSON.stringify({ siteCode, rows }) }),
    importOut: (siteCode: string, rows: { date: string; serial: string; reference: string; partNumber: string }[]) => request<{ imported: number; failed: number; errors: { row: number; error: string }[] }>('/parts/import/out', { method: 'POST', headers: siteHeaders(), body: JSON.stringify({ siteCode, rows }) }),
    downloadTemplate: async (kind: 'in' | 'out') => {
      const res = await fetch(`${BASE}/parts/template/${kind}`, { credentials: 'include', headers: siteHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to download template');
      }
      await saveBlob(await res.blob(), kind === 'in' ? 'parts-stock-in-template.xlsx' : 'parts-stock-out-template.xlsx');
    },
    sheetStatus: () => request<PartsSheetStatus>('/parts/sheets/status'),
    sheetConnectUrl: () => `${BASE}/parts/sheets/connect`,
    sheetDisconnect: () => request<{ message: string }>('/parts/sheets/disconnect', { method: 'DELETE' }),
    sheetConfig: () => request<{ config: { spreadsheet_id: string; spreadsheet_name: string; sheet_name: string } | null }>('/parts/sheets/config'),
    saveSheetConfig: (spreadsheetId: string, spreadsheetName: string, sheetName: string) => request<{ message: string }>('/parts/sheets/config', { method: 'POST', body: JSON.stringify({ spreadsheetId, spreadsheetName, sheetName }) }),
    sheetList: (spreadsheetId: string) => request<{ title: string; sheets: string[] }>(`/parts/sheets/list?spreadsheetId=${encodeURIComponent(spreadsheetId)}`),
    retrySheet: () => request<{ synced: number; remaining: number }>('/parts/sheets/retry', { method: 'POST' }),
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
    bulkUpdate: (id: number, codes: string[], action: 'complete' | 'exclude') =>
      request<{ action: string; updated: number; missingCodes: string[] }>(`/pcount/sessions/${id}/products/bulk`, {
        method: 'POST',
        body: JSON.stringify({ codes, action }),
      }),
    compare: (currentId: number, previousId: number) =>
      request<PcountComparison>(`/pcount/sessions/${currentId}/compare/${previousId}`),
  },

  pcountAdmin: {
    listSessions: () => request<PcountAdminSession[]>('/pcount/admin/sessions'),
    getSession: (id: number) =>
      request<PcountAdminDetail>(`/pcount/admin/sessions/${id}`),
    exportUrl: (id: number) => `/api/pcount/admin/sessions/${id}/export`,
  },

  products: {
    list: (sessionId: number, params?: { status?: string; search?: string; sort?: string; fresh?: boolean }) => {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.search) q.set('search', params.search);
      if (params?.sort) q.set('sort', params.sort);
      const qs = q.toString();
      const path = `/pcount/sessions/${sessionId}/products${qs ? `?${qs}` : ''}`;
      return params?.fresh ? requestFresh<Product[]>(path) : request<Product[]>(path);
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
    importSystem: (sessionId: number, products: unknown[], display_columns: string[], replace = false) =>
      request<{ message: string; count: number }>(`/pcount/sessions/${sessionId}/import-system${replace ? '?replace=true' : ''}`, {
        method: 'POST',
        body: JSON.stringify({ products, display_columns }),
      }),
    importCount: (sessionId: number, products: unknown[]) =>
      request<{ message: string }>(`/pcount/sessions/${sessionId}/import-count`, {
        method: 'POST',
        body: JSON.stringify({ products }),
      }),
    clearImports: (sessionId: number) =>
      request<{ message: string }>(`/pcount/sessions/${sessionId}/imports`, {
        method: 'DELETE',
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

export const labelMergerApi = {
  downloadUrl: () => request<{ url: string }>('/label-merger/download-url'),
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
