import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type User, type Role } from '../lib/api';
import { useAuth } from '../lib/auth';
import { invalidateQuery, useCachedQuery } from '../lib/queryCache';

function ActionIcon({ type }: { type: 'key' | 'trash' | 'lock' }) {
  const paths = {
    key: <><circle cx="8" cy="8" r="3" /><path d="m10.2 10.2 7.3 7.3M14 14l2-2M16 16l2-2" /></>,
    trash: <><path d="M4 6h12M8 3h4l1 3H7l1-3ZM6 6l.7 11h6.6L14 6M8.5 9v5M11.5 9v5" /></>,
    lock: <><rect x="5" y="10" width="10" height="8" rx="1" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  };
  return <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{paths[type]}</svg>;
}

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const usersQuery = useCachedQuery<User[]>('admin-users', api.admin.getUsers);
  const rolesQuery = useCachedQuery<Role[]>('admin-roles', api.admin.getRoles);
  const users = usersQuery.data || [];
  const roles = rolesQuery.data || [];
  const loading = usersQuery.loading || rolesQuery.loading;
  const [newRoleName, setNewRoleName] = useState('');
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  const loadData = async () => {
    await Promise.all([usersQuery.refresh(), rolesQuery.refresh()]);
  };

  const assignRole = async (userId: number, roleId: number) => {
    await api.admin.updateUserRole(userId, roleId);
    invalidateQuery('admin-users');
    loadData();
  };

  const deleteUser = async (userId: number, email: string) => {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
    await api.admin.deleteUser(userId);
    loadData();
  };

  const openReset = (user: User) => {
    setResetTarget(user);
    setNewPassword('');
    setResetError('');
  };

  const closeReset = () => {
    if (resetBusy) return;
    setResetTarget(null);
    setResetError('');
  };

  const resetPassword = async () => {
    if (!resetTarget) return;
    const pw = newPassword;
    if (pw.length < 12) {
      setResetError('Password must be at least 12 characters');
      return;
    }
    if (pw.length > 128) {
      setResetError('Password must be 128 characters or fewer');
      return;
    }
    if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) {
      setResetError('Password must include uppercase, lowercase, number, and special characters');
      return;
    }
    setResetBusy(true);
    setResetError('');
    try {
      await api.admin.resetPassword(resetTarget.id, pw);
      setResetTarget(null);
      setNewPassword('');
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setResetBusy(false);
    }
  };

  const createRole = async () => {
    if (!newRoleName.trim()) return;
    await api.admin.createRole(newRoleName.trim());
    setNewRoleName('');
    invalidateQuery('admin-roles');
    loadData();
  };

  const deleteRole = async (roleId: number) => {
    await api.admin.deleteRole(roleId);
    invalidateQuery('admin-roles');
    loadData();
  };

  if (loading) {
    return <p className="text-[14px] text-[#6e6e73]">Loading...</p>;
  }

  return (
    <div className="space-y-10">
      <div>
        <Link to="/admin" className="inline-flex items-center gap-1 text-[12px] font-medium text-[#6e6e73] hover:text-[#2563eb] transition-colors mb-2">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          Back to Admin
        </Link>
        <h1 className="text-[26px] font-semibold text-[#1d1d1f] tracking-tight">Users</h1>
        <p className="text-[14px] text-[#6e6e73] mt-1">Manage users and roles</p>
      </div>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[14px] font-semibold text-[#1d1d1f]">All users &middot; {users.length}</h2>
        </div>
        {users.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#d2d2d7] p-8 text-center">
            <p className="text-[13px] text-[#6e6e73]">No users yet</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[#d2d2d7] overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#d2d2d7]">
                  <th className="text-left px-4 py-2.5 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider">Email</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider">Role</th>
                  <th className="text-left px-4 py-2.5 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider">Date joined</th>
                  <th className="min-w-[170px] text-right px-4 py-2.5 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={`border-b border-[#d2d2d7] last:border-0 hover:bg-[#fafafa] transition-colors ${!u.roleId ? 'bg-[#fffbeb]' : ''}`}>
                    <td className="px-4 py-3 text-[#1d1d1f]">{u.fullName}</td>
                    <td className="px-4 py-3 text-[#6e6e73]">
                      {u.email}
                      {currentUser?.id === u.id && <span className="ml-2 text-[11px] text-[#6e6e73] font-medium">(you)</span>}
                      {!u.roleId && <span className="ml-2 text-[11px] text-[#d97706] font-medium">(pending)</span>}
                    </td>
                    <td className="px-4 py-3">
                      {u.roleName ? (
                        <span className="inline-flex items-center text-[12px] font-medium text-[#1d1d1f]">
                          {u.isSuperAdmin ? 'Super Admin' : u.roleName}
                        </span>
                      ) : (
                        <span className="text-[#6e6e73]">&mdash;</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[#6e6e73]">{formatJoinedDate(u.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="relative">
                          <select
                            value={u.roleId ? String(u.roleId) : ''}
                            disabled={Boolean(u.isSuperAdmin)}
                            onChange={(e) => {
                              const nextRoleId = Number(e.target.value);
                              if (nextRoleId && nextRoleId !== u.roleId) assignRole(u.id, nextRoleId);
                            }}
                            aria-label={`Change role for ${u.email}`}
                            className="h-8 appearance-none rounded-lg border border-[#d2d2d7] bg-white py-0 pl-2.5 pr-7 text-[12px] text-[#1d1d1f] outline-none transition-shadow cursor-pointer hover:border-[#b8b8bd] focus:border-[#8e8e93] focus:ring-2 focus:ring-[#1d1d1f]/10"
                          >
                            {u.isSuperAdmin ? (
                              <option value={u.roleId ? String(u.roleId) : ''}>Super Admin</option>
                            ) : (
                              <>
                                {!u.roleId && <option value="">Assign role</option>}
                                {roles.map((r) => (
                                  <option key={r.id} value={r.id}>{r.name}</option>
                                ))}
                              </>
                            )}
                          </select>
                          <svg aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#6e6e73]" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m3 4.5 3 3 3-3" />
                          </svg>
                        </div>
                        <button
                          onClick={() => openReset(u)}
                          title="Reset password"
                          aria-label={`Reset password for ${u.email}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#2563eb] hover:bg-[#f5f5f7] transition-colors cursor-pointer"
                        >
                          <ActionIcon type="key" />
                        </button>
                        <button
                          onClick={() => deleteUser(u.id, u.email)}
                          disabled={currentUser?.id === u.id}
                          title={currentUser?.id === u.id ? 'You cannot delete your own account' : undefined}
                          aria-label={currentUser?.id === u.id ? 'You cannot delete your own account' : `Delete ${u.email}`}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${currentUser?.id === u.id ? 'text-[#6e6e73] hover:bg-[#f5f5f7]' : 'text-[#dc2626] hover:bg-[#fef2f2] hover:text-[#b91c1c]'}`}
                        >
                          <ActionIcon type={currentUser?.id === u.id ? 'lock' : 'trash'} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[14px] font-semibold text-[#1d1d1f] mb-4">Roles</h2>
        <div className="bg-white rounded-xl border border-[#d2d2d7] p-5">
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder="New role name"
              className="h-9 px-3 text-[13px] border border-[#d2d2d7] bg-white text-[#1d1d1f] placeholder-[#6e6e73] outline-none focus:border-[#2563eb] flex-1 rounded-lg"
              onKeyDown={(e) => e.key === 'Enter' && createRole()}
            />
            <button
              onClick={createRole}
              className="px-4 py-2 bg-[#2563eb] text-white text-[13px] font-medium rounded-lg hover:bg-[#1d4ed8] transition-colors cursor-pointer"
            >
              Add role
            </button>
          </div>

          {roles.length === 0 ? (
            <p className="text-[13px] text-[#6e6e73]">No roles defined yet</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {roles.map((r) => (
                <div
                  key={r.id}
                  className="inline-flex items-center gap-2 px-3 py-1.5 border border-[#d2d2d7] text-[13px] text-[#1d1d1f] rounded-full"
                >
                  <span>{r.name}</span>
                  <button
                    onClick={() => deleteRole(r.id)}
                    className="text-[#6e6e73] hover:text-[#dc2626] transition-colors text-[15px] leading-none cursor-pointer"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {resetTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={closeReset}
          role="dialog"
          aria-modal="true"
          aria-label={`Reset password for ${resetTarget.email}`}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-[#d2d2d7] bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-semibold text-[#1d1d1f]">Reset password</h3>
            <p className="mt-1 text-[13px] text-[#6e6e73]">
              Set a new password for <span className="text-[#1d1d1f]">{resetTarget.email}</span>. The user will sign in with this password; give it to them in person or via a secure channel.
            </p>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && resetPassword()}
              placeholder="New password"
              autoFocus
              disabled={resetBusy}
              className="mt-4 h-9 w-full px-3 text-[13px] border border-[#d2d2d7] bg-white text-[#1d1d1f] placeholder-[#6e6e73] outline-none focus:border-[#2563eb] rounded-lg"
            />
            <p className="mt-1.5 text-[11px] text-[#6e6e73]">
              At least 12 characters with uppercase, lowercase, number, and special character.
            </p>
            {resetError && (
              <p className="mt-2 text-[12px] text-[#dc2626]" role="alert">{resetError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={closeReset}
                disabled={resetBusy}
                className="h-8 px-3 text-[12px] text-[#6e6e73] hover:text-[#1d1d1f] transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void resetPassword()}
                disabled={resetBusy}
                className="h-8 px-3 text-[12px] font-medium text-white bg-[#2563eb] rounded-lg hover:bg-[#1d4ed8] transition-colors cursor-pointer disabled:opacity-50"
              >
                {resetBusy ? 'Resetting…' : 'Reset password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatJoinedDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(date);
}
