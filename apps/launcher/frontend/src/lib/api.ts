let demoMode = false;

export function enableDemoMode() {
  demoMode = true;
}

export function isDemoMode() {
  return demoMode;
}

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      ...options,
    });
  } catch {
    enableDemoMode();
    throw new Error('Server unreachable — switched to demo mode');
  }

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

const demoUser: User = {
  id: 0,
  email: 'admin@mspi.io',
  fullName: 'Admin (Demo)',
  roleId: 1,
  roleName: 'Admin',
};

const demoTools: Tool[] = [
  { id: 1, name: 'Site Monitor', url: 'https://rfpu.mspi.io', icon: 'monitor', description: 'Real-time site monitoring and performance tracking for RFPU deployments.', roleIds: [2, 3, 4] },
  { id: 2, name: 'PCount', url: 'https://pcount.mspi.io', icon: 'database', description: 'Weekly merchandise inventory — import system export, scan products, and reconcile counts.', roleIds: [2, 3] },
  { id: 3, name: 'Reports', url: 'https://reports.mspi.io', icon: 'chart', description: 'GSX-Fixably data reporting and analytics dashboard.', roleIds: [2, 4] },
];

const demoRoles: Role[] = [
  { id: 1, name: 'Admin' },
  { id: 2, name: 'PMS' },
  { id: 3, name: 'CSO' },
  { id: 4, name: 'ENGR' },
];

const demoUsers: User[] = [
  { id: 1, email: 'alice@mspi.io', fullName: 'Alice Johnson', roleId: 2, roleName: 'PMS' },
  { id: 2, email: 'bob@mspi.io', fullName: 'Bob Chen', roleId: null, roleName: null },
  { id: 3, email: 'carol@mspi.io', fullName: 'Carol Martinez', roleId: 3, roleName: 'CSO' },
];

function delay<T>(data: T): Promise<T> {
  return new Promise((r) => setTimeout(() => r(data), 200));
}

export const api = {
  login: (email: string, password: string) =>
    isDemoMode() ? delay({ message: 'Demo login', user: demoUser }) :
    request<{ message: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  signup: (email: string, password: string, fullName: string) =>
    isDemoMode() ? delay({ message: 'Demo signup', user: { ...demoUser, fullName } }) :
    request<{ message: string; user: User }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, fullName }),
    }),

  logout: () =>
    isDemoMode() ? delay({ message: 'Logged out' }) :
    request<{ message: string }>('/auth/logout', { method: 'POST' }),

  me: () =>
    isDemoMode() ? delay(demoUser) :
    request<User>('/auth/me'),

  myTools: () =>
    isDemoMode() ? delay(demoTools) :
    request<Tool[]>('/my-tools'),

  admin: {
    getUsers: () =>
      isDemoMode() ? delay(demoUsers) :
      request<User[]>('/admin/users'),
    updateUserRole: (userId: number, roleId: number) =>
      isDemoMode() ? delay({ message: 'Role updated' }) :
      request<{ message: string }>(`/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ roleId }),
      }),
    getRoles: () =>
      isDemoMode() ? delay(demoRoles) :
      request<Role[]>('/admin/roles'),
    createRole: (name: string) =>
      isDemoMode() ? delay({ id: 99, name }) :
      request<Role>('/admin/roles', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    deleteRole: (roleId: number) =>
      isDemoMode() ? delay({ message: 'Role deleted' }) :
      request<{ message: string }>(`/admin/roles/${roleId}`, {
        method: 'DELETE',
      }),
    getTools: () =>
      isDemoMode() ? delay(demoTools) :
      request<Tool[]>('/admin/tools'),
    createTool: (tool: Omit<Tool, 'id'>) =>
      isDemoMode() ? delay({ id: 99, ...tool }) :
      request<Tool>('/admin/tools', {
        method: 'POST',
        body: JSON.stringify(tool),
      }),
    updateTool: (id: number, tool: Omit<Tool, 'id'>) =>
      isDemoMode() ? delay({ id, ...tool }) :
      request<Tool>(`/admin/tools/${id}`, {
        method: 'PUT',
        body: JSON.stringify(tool),
      }),
    deleteTool: (id: number) =>
      isDemoMode() ? delay({ message: 'Tool deleted' }) :
      request<{ message: string }>(`/admin/tools/${id}`, {
        method: 'DELETE',
      }),
  },
};
