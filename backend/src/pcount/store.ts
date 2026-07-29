import { getDb, getDbPool } from '../db/index.js';
import { pcountSessions, pcountDisplayColumns, pcountProducts, pcountProductExtra } from '../db/schema.js';
import { eq, and, desc, asc, like, inArray } from 'drizzle-orm';

let dbAvailable = false;

export function setDbAvailable(v: boolean) {
  dbAvailable = v;
}

export function isDbAvailable() {
  return dbAvailable;
}

export interface SessionRow {
  id: number;
  name: string;
  status: string;
  sort_desc: number;
  created_at: string;
  updated_at: string;
}

export interface ProductRow {
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
}

export interface ProductWithExtra extends ProductRow {
  extra: Record<string, string>;
}

export interface SessionWithProgress extends SessionRow {
  progress: number;
  total: number;
  checked: number;
  display_columns?: string[];
  online_count?: number;
  active_scanner_count?: number;
}

function castSession(s: typeof pcountSessions.$inferSelect): SessionRow {
  return { id: s.id, name: s.name, status: s.status, sort_desc: s.sort_desc, created_at: String(s.created_at), updated_at: String(s.updated_at) };
}

function castProduct(p: typeof pcountProducts.$inferSelect): ProductRow {
  return { id: p.id, session_id: p.session_id, product_code: p.product_code, description: p.description || '', category: p.category || '', system_qty: p.system_qty || 0, counted_qty: p.counted_qty || 0, adjusted_qty: p.adjusted_qty, status: p.status, notes: p.notes };
}

async function attachExtras(rows: (typeof pcountProducts.$inferSelect)[]): Promise<ProductWithExtra[]> {
  if (rows.length === 0) return [];
  const db = getDb();
  const ids = rows.map(r => r.id);
  const allExtras = await db.select().from(pcountProductExtra).where(inArray(pcountProductExtra.product_id, ids));
  const map = new Map<number, Record<string, string>>();
  for (const e of allExtras) {
    if (!map.has(e.product_id)) map.set(e.product_id, {});
    map.get(e.product_id)![e.column_name] = e.column_value || '';
  }
  return rows.map(r => ({ ...castProduct(r), extra: map.get(r.id) || {} }));
}

async function dbListProducts(sessionId: number, opts?: { status?: string; sort?: string }): Promise<ProductWithExtra[]> {
  const db = getDb();
  const conds = [eq(pcountProducts.session_id, sessionId)];
  if (opts?.status && opts.status !== 'all') conds.push(eq(pcountProducts.status, opts.status));
  const order = opts?.sort === 'asc' ? [asc(pcountProducts.product_code)] : [desc(pcountProducts.product_code)];
  const rows = await db.select().from(pcountProducts).where(and(...conds)).orderBy(...order);
  return attachExtras(rows);
}

async function dbGetProduct(sessionId: number, code: string): Promise<ProductWithExtra | null> {
  const db = getDb();
  const [row] = await db.select().from(pcountProducts).where(and(eq(pcountProducts.session_id, sessionId), eq(pcountProducts.product_code, code)));
  if (!row) return null;
  return (await attachExtras([row]))[0];
}

const memSessions = new Map<number, SessionRow>();
const memDisplayColumns = new Map<number, string[]>();
const memProducts = new Map<number, ProductRow>();
const memProductExtras = new Map<number, Record<string, string>>();
let nextSessionId = 1;
let nextProductId = 1;

function memNow() {
  return new Date().toISOString();
}

function memListProducts(sessionId: number, opts?: { status?: string; sort?: string }): ProductWithExtra[] {
  let prods = Array.from(memProducts.values()).filter(p => p.session_id === sessionId);
  if (opts?.status && opts.status !== 'all') prods = prods.filter(p => p.status === opts.status);
  prods.sort((a, b) => opts?.sort === 'asc'
    ? a.product_code.localeCompare(b.product_code)
    : b.product_code.localeCompare(a.product_code));
  return prods.map(p => ({ ...p, extra: memProductExtras.get(p.id) || {} }));
}

function memGetProduct(sessionId: number, code: string): ProductWithExtra | null {
  const p = Array.from(memProducts.values()).find(x => x.session_id === sessionId && x.product_code === code);
  if (!p) return null;
  return { ...p, extra: memProductExtras.get(p.id) || {} };
}

export async function createSession(name: string): Promise<SessionRow> {
  if (dbAvailable) {
    const db = getDb();
    const [inserted] = await db.insert(pcountSessions).values({ name }).$returningId();
    const [row] = await db.select().from(pcountSessions).where(eq(pcountSessions.id, inserted.id));
    return castSession(row);
  }
  const id = nextSessionId++;
  const row: SessionRow = { id, name, status: 'active', sort_desc: 1, created_at: memNow(), updated_at: memNow() };
  memSessions.set(id, row);
  return row;
}

async function dbSessionWithProgress(s: typeof pcountSessions.$inferSelect): Promise<SessionWithProgress> {
  const db = getDb();
  const pool = getDbPool();
  const [rows] = await pool.execute(
    'SELECT COUNT(*) as total, SUM(CASE WHEN status != ? THEN 1 ELSE 0 END) as checked FROM pcount_products WHERE session_id = ?',
    ['pending', s.id]
  );
  const row = (rows as any[])[0];
  const total = Number(row?.total || 0);
  const checked = Number(row?.checked || 0);
  const cols = await db.select().from(pcountDisplayColumns).where(eq(pcountDisplayColumns.session_id, s.id));
  return { ...castSession(s), progress: total > 0 ? Math.round((checked / total) * 100) : 0, total, checked, display_columns: cols.map(c => c.column_name) };
}

export async function listSessions(): Promise<SessionWithProgress[]> {
  if (dbAvailable) {
    const db = getDb();
    const sessions = await db.select().from(pcountSessions).orderBy(desc(pcountSessions.created_at));
    return Promise.all(sessions.map(s => dbSessionWithProgress(s)));
  }
  const sessions = Array.from(memSessions.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return sessions.map(s => {
    const prods = Array.from(memProducts.values()).filter(p => p.session_id === s.id);
    const total = prods.length;
    const checked = prods.filter(p => p.status !== 'pending').length;
    return { ...s, progress: total > 0 ? Math.round((checked / total) * 100) : 0, total, checked, display_columns: memDisplayColumns.get(s.id) || [] };
  });
}

export async function getSession(id: number): Promise<SessionWithProgress | null> {
  if (dbAvailable) {
    const db = getDb();
    const [row] = await db.select().from(pcountSessions).where(eq(pcountSessions.id, id));
    if (!row) return null;
    return dbSessionWithProgress(row);
  }
  const row = memSessions.get(id);
  if (!row) return null;
  const prods = Array.from(memProducts.values()).filter(p => p.session_id === id);
  const total = prods.length;
  const checked = prods.filter(p => p.status !== 'pending').length;
  return { ...row, progress: total > 0 ? Math.round((checked / total) * 100) : 0, total, checked, display_columns: memDisplayColumns.get(id) || [] };
}

export async function updateSession(id: number, data: Partial<SessionRow>): Promise<SessionRow | null> {
  if (dbAvailable) {
    const db = getDb();
    const { name, status, sort_desc } = data;
    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (status !== undefined) update.status = status;
    if (sort_desc !== undefined) update.sort_desc = sort_desc;
    await db.update(pcountSessions).set(update).where(eq(pcountSessions.id, id));
    const [row] = await db.select().from(pcountSessions).where(eq(pcountSessions.id, id));
    return castSession(row);
  }
  const existing = memSessions.get(id);
  if (!existing) return null;
  const updated = { ...existing, ...data, updated_at: memNow() };
  memSessions.set(id, updated);
  return updated;
}

export async function deleteSession(id: number): Promise<void> {
  if (dbAvailable) {
    const db = getDb();
    await db.delete(pcountSessions).where(eq(pcountSessions.id, id));
    return;
  }
  memSessions.delete(id);
  memDisplayColumns.delete(id);
  for (const [pid, p] of memProducts) {
    if (p.session_id === id) { memProducts.delete(pid); memProductExtras.delete(pid); }
  }
}

export async function deleteSessionProducts(sessionId: number): Promise<void> {
  if (dbAvailable) {
    const db = getDb();
    const prods = await db.select({ id: pcountProducts.id }).from(pcountProducts).where(eq(pcountProducts.session_id, sessionId));
    for (const p of prods) {
      await db.delete(pcountProductExtra).where(eq(pcountProductExtra.product_id, p.id));
    }
    await db.delete(pcountProducts).where(eq(pcountProducts.session_id, sessionId));
    return;
  }
  for (const [pid, p] of memProducts) {
    if (p.session_id === sessionId) { memProducts.delete(pid); memProductExtras.delete(pid); }
  }
}

export async function setDisplayColumns(sessionId: number, columns: string[]): Promise<void> {
  if (dbAvailable) {
    const db = getDb();
    await db.delete(pcountDisplayColumns).where(eq(pcountDisplayColumns.session_id, sessionId));
    for (const col of columns) {
      await db.insert(pcountDisplayColumns).values({ session_id: sessionId, column_name: col });
    }
    return;
  }
  memDisplayColumns.set(sessionId, columns);
}

export async function listProducts(sessionId: number, opts?: { status?: string; sort?: string }): Promise<ProductWithExtra[]> {
  if (dbAvailable) return dbListProducts(sessionId, opts);
  return memListProducts(sessionId, opts);
}

export async function getProduct(sessionId: number, code: string): Promise<ProductWithExtra | null> {
  if (dbAvailable) return dbGetProduct(sessionId, code);
  return memGetProduct(sessionId, code);
}

export async function updateProduct(sessionId: number, code: string, data: Partial<ProductRow>): Promise<ProductWithExtra | null> {
  if (dbAvailable) {
    const db = getDb();
    await db.update(pcountProducts).set(data).where(and(eq(pcountProducts.session_id, sessionId), eq(pcountProducts.product_code, code)));
    return dbGetProduct(sessionId, code);
  }
  const p = Array.from(memProducts.values()).find(x => x.session_id === sessionId && x.product_code === code);
  if (!p) return null;
  const updated = { ...p, ...data };
  memProducts.set(updated.id, updated);
  return { ...updated, extra: memProductExtras.get(updated.id) || {} };
}

export async function createProducts(sessionId: number, products: { product_code: string; description: string; system_qty: number; extra?: Record<string, string> }[]): Promise<number> {
  if (products.length === 0) return 0;

  if (dbAvailable) {
    const db = getDb();
    const batchSize = 1000;
    const pool = getDbPool();

    const allExtraRows: { product_id: number; column_name: string; column_value: string }[] = [];
    const codeToId = new Map<string, number>();

    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);

      const placeholders = batch.map(() => '(?,?,?,?,?,?,?)').join(',');
      const params: any[] = [];
      for (const p of batch) {
        params.push(sessionId, p.product_code, p.description || '', parseCategory(p.product_code), p.system_qty || 0, 0, 'pending');
      }

      const [rows] = await pool.execute(
        `INSERT INTO pcount_products (session_id,product_code,description,category,system_qty,counted_qty,status) VALUES ${placeholders} RETURNING id,product_code`,
        params
      );

      for (const r of rows as any[]) {
        codeToId.set(r.product_code, r.id);
      }
    }

    for (const p of products) {
      if (p.extra) {
        const pid = codeToId.get(p.product_code);
        if (!pid) continue;
        for (const [key, value] of Object.entries(p.extra)) {
          if (key !== 'product_code' && key !== 'description' && key !== 'system_qty') {
            allExtraRows.push({ product_id: pid, column_name: key, column_value: String(value || '') });
          }
        }
      }
    }

    if (allExtraRows.length > 0) {
      const placeholders = allExtraRows.map(() => '(?,?,?)').join(',');
      const params: any[] = [];
      for (const r of allExtraRows) {
        params.push(r.product_id, r.column_name, r.column_value);
      }
      await pool.execute(`INSERT INTO pcount_product_extra (product_id,column_name,column_value) VALUES ${placeholders}`, params);
    }
  } else {
    for (const p of products) {
      const id = nextProductId++;
      memProducts.set(id, {
        id, session_id: sessionId,
        product_code: p.product_code,
        description: p.description || '',
        category: parseCategory(p.product_code),
        system_qty: p.system_qty || 0,
        counted_qty: 0,
        adjusted_qty: null,
        status: 'pending',
        notes: null,
      });
      if (p.extra) {
        const extras: Record<string, string> = {};
        for (const [key, value] of Object.entries(p.extra)) {
          if (key !== 'product_code' && key !== 'description' && key !== 'system_qty') {
            extras[key] = String(value || '');
          }
        }
        memProductExtras.set(id, extras);
      }
    }
  }

  return products.length;
}

export async function importCount(sessionId: number, products: { product_code: string; counted_qty: number }[]): Promise<number> {
  const codeMap = new Map<string, number>();
  for (const p of products) {
    if (p.product_code) codeMap.set(p.product_code.toUpperCase(), p.counted_qty || 0);
  }

  const existing = await listProducts(sessionId);
  let matched = 0;

  if (dbAvailable) {
    const db = getDb();
    const updates: { code: string; counted_qty: number; status: string }[] = [];

    for (const ep of existing) {
      const upperCode = ep.product_code.toUpperCase();
      let countedQty = codeMap.get(upperCode);
      if (countedQty === undefined) {
        const stripped = upperCode.replace(/^0+/, '');
        for (const [key, val] of codeMap) {
          if (key.replace(/^0+/, '') === stripped) { countedQty = val; break; }
        }
      }
      if (countedQty !== undefined) {
        let status: string;
        if (countedQty === ep.system_qty) {
          status = 'matched';
        } else if (countedQty > ep.system_qty) {
          status = 'over';
        } else {
          status = 'missing';
        }
        updates.push({ code: ep.product_code, counted_qty: countedQty, status });
        matched++;
      }
    }

    if (updates.length > 0) {
      await db.transaction(async (tx) => {
        for (const u of updates) {
          await tx.update(pcountProducts)
            .set({ counted_qty: u.counted_qty, status: u.status as any })
            .where(and(eq(pcountProducts.session_id, sessionId), eq(pcountProducts.product_code, u.code)));
        }
      });
    }
  } else {
    for (const ep of existing) {
      const upperCode = ep.product_code.toUpperCase();
      let countedQty = codeMap.get(upperCode);
      if (countedQty === undefined) {
        const stripped = upperCode.replace(/^0+/, '');
        for (const [key, val] of codeMap) {
          if (key.replace(/^0+/, '') === stripped) { countedQty = val; break; }
        }
      }
      if (countedQty !== undefined) {
        let status: string;
        if (countedQty === ep.system_qty) {
          status = 'matched';
        } else if (countedQty > ep.system_qty) {
          status = 'over';
        } else {
          status = 'missing';
        }
        await updateProduct(sessionId, ep.product_code, { counted_qty: countedQty, status });
        matched++;
      }
    }
  }

  return matched;
}

export async function scanProduct(sessionId: number, product_code: string): Promise<{ product: ProductWithExtra; match: boolean } | null> {
  if (dbAvailable) {
    const pool = getDbPool();

    await pool.execute(
      `UPDATE pcount_products
       SET counted_qty = CASE
         WHEN status IN ('pending', 'missing', 'matched', 'over') THEN COALESCE(counted_qty, 0) + 1
         ELSE COALESCE(counted_qty, 0)
       END,
       status = CASE
         WHEN status IN ('pending', 'missing', 'matched', 'over') AND counted_qty > system_qty THEN 'over'
         WHEN status IN ('pending', 'missing', 'matched', 'over') AND counted_qty = system_qty THEN 'matched'
         WHEN status IN ('pending', 'missing', 'matched', 'over') THEN 'missing'
         ELSE status
       END
       WHERE session_id = ? AND product_code = ?`,
      [sessionId, product_code]
    );

    const product = await dbGetProduct(sessionId, product_code);
    if (!product) return null;
    return { product, match: product.counted_qty === product.system_qty };
  }

  const product = await getProduct(sessionId, product_code);
  if (!product) return null;

  let newCounted = product.counted_qty;
  let newStatus = product.status;

  if (['pending', 'missing', 'matched', 'over'].includes(product.status)) {
    newCounted = product.counted_qty + 1;
    newStatus = newCounted > product.system_qty
      ? 'over'
      : newCounted === product.system_qty ? 'matched' : 'missing';
  }

  const isMatch = newCounted === product.system_qty;

  if (newCounted !== product.counted_qty || newStatus !== product.status) {
    const updated = await updateProduct(sessionId, product_code, { counted_qty: newCounted, status: newStatus });
    if (updated) return { product: updated, match: isMatch };
  }

  return { product, match: isMatch };
}

function parseCategory(code: string): string {
  const u = code.toUpperCase();
  if (u.startsWith('APP') || u.startsWith('APL')) return 'apple';
  if (u.startsWith('3PP') || u.startsWith('THR')) return '3pp';
  return '';
}

export async function hasScannedProducts(sessionId: number): Promise<boolean> {
  const products = await listProducts(sessionId);
  return products.some(p => p.counted_qty > 0);
}
