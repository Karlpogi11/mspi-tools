import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Tool, type Role } from '../lib/api';
import { invalidateQuery, useCachedQuery } from '../lib/queryCache';
import { useAuth } from '../lib/auth';

interface ToolForm {
  name: string;
  url: string;
  icon: string;
  description: string;
  roleIds: number[];
}

const emptyForm: ToolForm = { name: '', url: '', icon: 'default', description: '', roleIds: [] };

export default function AdminToolsPage() {
  const { user } = useAuth();
  const canManageTools = Boolean(user?.isSuperAdmin);
  const toolsQuery = useCachedQuery<Tool[]>('admin-tools', api.admin.getTools);
  const rolesQuery = useCachedQuery<Role[]>('admin-roles', api.admin.getRoles);
  const tools = toolsQuery.data || [];
  const roles = rolesQuery.data || [];
  const loading = toolsQuery.loading || rolesQuery.loading;
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ToolForm>(emptyForm);

  const loadData = async () => {
    await Promise.all([toolsQuery.refresh(), rolesQuery.refresh()]);
  };

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  };

  const editTool = (tool: Tool) => {
    setForm({
      name: tool.name,
      url: tool.url,
      icon: tool.icon,
      description: tool.description,
      roleIds: tool.roleIds || [],
    });
    setEditingId(tool.id);
    setShowForm(true);
  };

  const saveTool = async () => {
    if (editingId) {
      await api.admin.updateTool(editingId, form);
    } else {
      await api.admin.createTool(form);
    }
    resetForm();
    invalidateQuery('admin-tools');
    loadData();
  };

  const deleteTool = async (id: number) => {
    const tool = tools.find((item) => item.id === id);
    if (!tool || !window.confirm(`Delete ${tool.name}? This will also remove its role access configuration.`)) return;
    await api.admin.deleteTool(id);
    invalidateQuery('admin-tools');
    loadData();
  };

  const toolIconOptions = [
    { value: 'monitor', label: 'Monitor' },
    { value: 'tools', label: 'Tools' },
    { value: 'merge', label: 'Merge' },
    { value: 'chart', label: 'Chart' },
    { value: 'database', label: 'Database' },
    { value: 'clipboard', label: 'Clipboard' },
    { value: 'table', label: 'Table' },
    { value: 'tag', label: 'Tag' },
    { value: 'file', label: 'File' },
    { value: 'default', label: 'Default' },
  ];

  if (loading) {
    return <p className="text-[14px] text-[#6e6e73]">Loading...</p>;
  }

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/admin" className="inline-flex items-center gap-1 text-[12px] font-medium text-[#6e6e73] hover:text-[#2563eb] transition-colors mb-2">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            Back to Admin
          </Link>
          <h1 className="text-[26px] font-semibold text-[#1d1d1f] tracking-tight">Tools</h1>
          <p className="text-[14px] text-[#6e6e73] mt-1">Configure internal tools and access</p>
        </div>
        {canManageTools && <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="px-4 py-2 bg-[#2563eb] text-white text-[13px] font-medium rounded-lg hover:bg-[#1d4ed8] transition-colors cursor-pointer"
        >
          Add tool
        </button>}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-[#d2d2d7] p-6">
          <h2 className="text-[15px] font-semibold text-[#1d1d1f] mb-5">
            {editingId ? 'Edit tool' : 'New tool'}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[13px] font-medium text-[#1d1d1f] mb-1.5">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full h-9 px-3 text-[13px] border border-[#d2d2d7] bg-white text-[#1d1d1f] outline-none focus:border-[#2563eb]"
                placeholder="Site Monitor"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#1d1d1f] mb-1.5">URL</label>
              <input
                type="text"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                className="w-full h-9 px-3 text-[13px] border border-[#d2d2d7] bg-white text-[#1d1d1f] outline-none focus:border-[#2563eb]"
                placeholder="/pcount"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#1d1d1f] mb-1.5">Icon</label>
              <select
                value={form.icon}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                className="w-full h-9 px-3 text-[13px] border border-[#d2d2d7] bg-white text-[#1d1d1f] outline-none focus:border-[#2563eb] cursor-pointer"
              >
                {toolIconOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-[#1d1d1f] mb-1.5">Role access</label>
              <div className="flex flex-wrap gap-2 pt-1">
                {roles.map((r) => (
                  <label key={r.id} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.roleIds.includes(r.id)}
                      onChange={(e) => {
                        setForm({
                          ...form,
                          roleIds: e.target.checked
                            ? [...form.roleIds, r.id]
                            : form.roleIds.filter((id) => id !== r.id),
                        });
                      }}
                      className="accent-[#2563eb]"
                    />
                    <span className="text-[13px] text-[#1d1d1f]">{r.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[13px] font-medium text-[#1d1d1f] mb-1.5">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full h-9 px-3 text-[13px] border border-[#d2d2d7] bg-white text-[#1d1d1f] outline-none focus:border-[#2563eb]"
                placeholder="Monitor site performance and uptime"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <button
              onClick={saveTool}
              className="px-4 py-2 bg-[#2563eb] text-white text-[13px] font-medium rounded-lg hover:bg-[#1d4ed8] transition-colors cursor-pointer"
            >
              {editingId ? 'Save changes' : 'Create tool'}
            </button>
            <button
              onClick={resetForm}
              className="px-4 py-2 border border-[#d2d2d7] text-[13px] text-[#1d1d1f] font-medium rounded-lg hover:bg-[#f5f5f7] transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {tools.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#d2d2d7] p-8 text-center">
          <p className="text-[14px] text-[#1d1d1f] font-medium">No tools configured</p>
          <p className="text-[13px] text-[#6e6e73] mt-1.5">
            Add your first internal tool to get started.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#d2d2d7] overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#d2d2d7]">
                <th className="text-left px-4 py-2.5 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider">URL</th>
                <th className="text-left px-4 py-2.5 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider">Roles</th>
                <th className="text-right px-4 py-2.5 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => (
                <tr key={tool.id} className="border-b border-[#d2d2d7] last:border-0 hover:bg-[#fafafa] transition-colors">
                  <td className="px-4 py-3 text-[#1d1d1f] font-medium">{tool.name}</td>
                  <td className="px-4 py-3 text-[#2563eb]">{tool.url}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 flex-wrap">
                      {tool.roleIds && tool.roleIds.length > 0 ? (
                        tool.roleIds.map((rid) => {
                          const role = roles.find((r) => r.id === rid);
                          return role ? (
                            <span key={rid} className="text-[12px] text-[#1d1d1f]">
                              {role.name}
                            </span>
                          ) : null;
                        })
                      ) : (
                        <span className="text-[#6e6e73]">None</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      {canManageTools && <>
                        <button
                          onClick={() => editTool(tool)}
                          className="text-[13px] text-[#2563eb] hover:text-[#1d4ed8] transition-colors cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteTool(tool.id)}
                          className="text-[13px] text-[#6e6e73] hover:text-[#dc2626] transition-colors cursor-pointer"
                        >
                          Delete
                        </button>
                      </>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
