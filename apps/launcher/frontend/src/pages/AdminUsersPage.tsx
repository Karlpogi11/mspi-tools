import { useState, useEffect } from 'react';
import { api, type User, type Role } from '../lib/api';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRoleName, setNewRoleName] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([api.admin.getUsers(), api.admin.getRoles()]);
      setUsers(u);
      setRoles(r);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const assignRole = async (userId: number, roleId: number) => {
    await api.admin.updateUserRole(userId, roleId);
    loadData();
  };

  const deleteUser = async (userId: number, email: string) => {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
    await api.admin.deleteUser(userId);
    loadData();
  };

  const createRole = async () => {
    if (!newRoleName.trim()) return;
    await api.admin.createRole(newRoleName.trim());
    setNewRoleName('');
    loadData();
  };

  const deleteRole = async (roleId: number) => {
    await api.admin.deleteRole(roleId);
    loadData();
  };

  if (loading) {
    return <p className="text-[14px] text-[#6e6e73]">Loading...</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[24px] font-semibold text-[#1d1d1f]">User Management</h1>
        <p className="text-[14px] text-[#6e6e73] mt-1">Assign roles to users</p>
      </div>

        <section>
          <h2 className="text-[15px] font-semibold text-[#1d1d1f] mb-3">
            All users ({users.length})
          </h2>
          {users.length === 0 ? (
            <div className="bg-white rounded-xl border border-[#d2d2d7] p-6 text-center shadow-sm">
              <p className="text-[13px] text-[#6e6e73]">No users yet</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-[#d2d2d7] overflow-hidden shadow-sm">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#d2d2d7] bg-[#f5f5f7]">
                    <th className="text-left px-4 py-2.5 font-medium text-[#6e6e73]">Name</th>
                    <th className="text-left px-4 py-2.5 font-medium text-[#6e6e73]">Email</th>
                    <th className="text-left px-4 py-2.5 font-medium text-[#6e6e73]">Role</th>
                    <th className="text-right px-4 py-2.5 font-medium text-[#6e6e73]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className={`border-b border-[#d2d2d7] last:border-0 hover:bg-[#f5f5f7] transition-colors ${!u.roleId ? 'bg-[#fffbeb]' : ''}`}>
                      <td className="px-4 py-2.5 text-[#1d1d1f]">{u.fullName}</td>
                      <td className="px-4 py-2.5 text-[#6e6e73]">
                        {u.email}
                        {!u.roleId && <span className="ml-2 text-[11px] text-[#d97706] font-medium">(pending)</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {u.roleName ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[12px] font-medium bg-[#f5f5f7] text-[#1d1d1f] border border-[#d2d2d7]">
                            {u.roleName}
                          </span>
                        ) : (
                          <span className="text-[#6e6e73]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value) assignRole(u.id, Number(e.target.value));
                            }}
                            className="h-8 px-2 text-[13px] border border-[#d2d2d7] rounded-lg bg-white text-[#1d1d1f] outline-none focus:border-[#2563eb] cursor-pointer"
                          >
                            <option value="">{u.roleId ? 'Change role' : 'Assign role'}</option>
                            {roles.map((r) => (
                              <option key={r.id} value={r.id} selected={r.id === u.roleId}>{r.name}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => deleteUser(u.id, u.email)}
                            className="h-8 px-2 text-[13px] text-[#dc2626] hover:bg-[#fef2f2] rounded-lg transition-colors cursor-pointer"
                          >
                            Delete
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
        <h2 className="text-[15px] font-semibold text-[#1d1d1f] mb-3">Manage roles</h2>
        <div className="bg-white rounded-xl border border-[#d2d2d7] p-5 shadow-sm">
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder="New role name"
              className="h-9 px-3 text-[14px] border border-[#d2d2d7] rounded-lg bg-white text-[#1d1d1f] placeholder-[#6e6e73] outline-none focus:border-[#2563eb] flex-1"
              onKeyDown={(e) => e.key === 'Enter' && createRole()}
            />
            <button
              onClick={createRole}
              className="h-9 px-4 bg-[#2563eb] text-white text-[13px] font-medium rounded-lg hover:bg-[#1d4ed8] transition-colors cursor-pointer"
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
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#f5f5f7] border border-[#d2d2d7] rounded-lg text-[13px] text-[#1d1d1f]"
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
    </div>
  );
}
