import { getDb, getDbPool } from '../db/index.js';
import { pcountSessions, pcountSessionMembers, pcountDisplayColumns, pcountProducts, pcountProductExtra, users } from '../db/schema.js';
import { eq, and, desc, asc, like, inArray, or, sql } from 'drizzle-orm';

let dbAvailable = false;

export function setDbAvailable(v: boolean) {
  dbAvailable = v;
}

export function isDbAvailable() {
  return dbAvailable;
}

export class PcountError extends Error {
  status: number;
  data?: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export interface SessionRow {
  id: number;
  name: string;
  status: string;
  sort_desc: number;
  created_by: number | null;
  join_code: string | null;
  submitted_at: string | null;
  submitted_by: number | null;
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

export interface ProductComparisonRow {
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

export interface SessionWithProgress extends SessionRow {
  progress: number;
  total: number;
  checked: number;
  display_columns?: string[];
  online_count?: number;
  active_scanner_count?: number;
  is_owner?: boolean;
  joined?: boolean;
  owner_email?: string | null;
}

function castSession(s: typeof pcountSessions.$inferSelect): SessionRow {
  return {
    id: s.id, name: s.name, status: s.status, sort_desc: s.sort_desc,
    created_by: s.created_by, join_code: s.join_code,
    submitted_at: s.submitted_at ? String(s.submitted_at) : null,
    submitted_by: s.submitted_by,
    created_at: String(s.created_at), updated_at: String(s.updated_at),
  };
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

export function generateJoinCode(): string {
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  return code;
}

export async function isMember(sessionId: number, userId: number): Promise<boolean> {
  if (dbAvailable) {
    const db = getDb();
    const rows = await db
      .select({ id: pcountSessionMembers.user_id })
      .from(pcountSessionMembers)
      .where(and(eq(pcountSessionMembers.session_id, sessionId), eq(pcountSessionMembers.user_id, userId)))
      .limit(1);
    return rows.length > 0;
  }
  const s = memSessions.get(sessionId);
  return s ? (s.created_by === userId || memMembers.get(sessionId)?.has(userId) || false) : false;
}

export async function assertMember(sessionId: number, userId: number): Promise<void> {
  if (!(await isMember(sessionId, userId))) {
    throw new PcountError(403, 'You do not have access to this session');
  }
}

export async function assertOwner(sessionId: number, userId: number): Promise<void> {
  if (!(await isOwner(sessionId, userId))) {
    throw new PcountError(403, 'Only the session creator can do this');
  }
}

export async function isOwner(sessionId: number, userId: number): Promise<boolean> {
  if (dbAvailable) {
    const db = getDb();
    const [row] = await db.select({ created_by: pcountSessions.created_by }).from(pcountSessions).where(eq(pcountSessions.id, sessionId)).limit(1);
    return row?.created_by === userId;
  }
  return memSessions.get(sessionId)?.created_by === userId;
}

export async function isSubmitted(sessionId: number): Promise<boolean> {
  if (dbAvailable) {
    const db = getDb();
    const [row] = await db.select({ submitted_at: pcountSessions.submitted_at }).from(pcountSessions).where(eq(pcountSessions.id, sessionId)).limit(1);
    return Boolean(row?.submitted_at);
  }
  return Boolean(memSessions.get(sessionId)?.submitted_at);
}

export async function assertWritable(sessionId: number): Promise<void> {
  if (await isSubmitted(sessionId)) {
    throw new PcountError(409, 'Session has been submitted and is locked. Reopen it to make changes.');
  }
}

export async function assertExists(sessionId: number): Promise<void> {
  if (dbAvailable) {
    const db = getDb();
    const [row] = await db.select({ id: pcountSessions.id }).from(pcountSessions).where(eq(pcountSessions.id, sessionId)).limit(1);
    if (!row) throw new PcountError(404, 'Session not found');
    return;
  }
  if (!memSessions.has(sessionId)) throw new PcountError(404, 'Session not found');
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
const memMembers = new Map<number, Set<number>>();
const memDisplayColumns = new Map<number, string[]>();
const memProducts = new Map<number, ProductRow>();
const memProductExtras = new Map<number, Record<string, string>>();
const memJoinCodes = new Set<string>();
let nextSessionId = 100;
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

async function ensureUniqueJoinCode(): Promise<string> {
  if (dbAvailable) {
    const db = getDb();
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = generateJoinCode();
      const [existing] = await db.select({ id: pcountSessions.id }).from(pcountSessions).where(eq(pcountSessions.join_code, code)).limit(1);
      if (!existing) return code;
    }
    throw new PcountError(500, 'Could not generate a unique join code');
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateJoinCode();
    if (!memJoinCodes.has(code)) {
      memJoinCodes.add(code);
      return code;
    }
  }
  throw new PcountError(500, 'Could not generate a unique join code');
}

export async function createSession(name: string, createdBy: number): Promise<SessionRow> {
  const joinCode = await ensureUniqueJoinCode();

  if (dbAvailable) {
    const db = getDb();
    const [inserted] = await db.insert(pcountSessions).values({ name, created_by: createdBy, join_code: joinCode }).$returningId();
    await db.insert(pcountSessionMembers).values({ session_id: inserted.id, user_id: createdBy });
    const [row] = await db.select().from(pcountSessions).where(eq(pcountSessions.id, inserted.id));
    return castSession(row);
  }
  const id = nextSessionId++;
  const row: SessionRow = {
    id, name, status: 'active', sort_desc: 1, created_by: createdBy, join_code: joinCode,
    submitted_at: null, submitted_by: null, created_at: memNow(), updated_at: memNow(),
  };
  memSessions.set(id, row);
  const members = new Set<number>();
  members.add(createdBy);
  memMembers.set(id, members);
  return row;
}

export async function joinSession(joinCode: string, userId: number): Promise<SessionRow> {
  const code = joinCode.trim();

  if (dbAvailable) {
    const db = getDb();
    const [row] = await db.select().from(pcountSessions).where(eq(pcountSessions.join_code, code)).limit(1);
    if (!row) throw new PcountError(404, 'No session found with that code');

    if (row.created_by === userId) {
      throw new PcountError(409, 'You already own this session', { sessionId: row.id });
    }

    const [existing] = await db
      .select({ id: pcountSessionMembers.user_id })
      .from(pcountSessionMembers)
      .where(and(eq(pcountSessionMembers.session_id, row.id), eq(pcountSessionMembers.user_id, userId)))
      .limit(1);

    if (!existing) {
      await db.insert(pcountSessionMembers).values({ session_id: row.id, user_id: userId });
    }
    return castSession(row);
  }

  const session = Array.from(memSessions.values()).find(s => s.join_code === code);
  if (!session) throw new PcountError(404, 'No session found with that code');
  if (session.created_by === userId) throw new PcountError(409, 'You already own this session', { sessionId: session.id });
  if (!memMembers.has(session.id)) memMembers.set(session.id, new Set());
  memMembers.get(session.id)!.add(userId);
  return session;
}

export async function findSessionByCode(joinCode: string): Promise<SessionRow | null> {
  const code = joinCode.trim();
  if (dbAvailable) {
    const db = getDb();
    const [row] = await db.select().from(pcountSessions).where(eq(pcountSessions.join_code, code)).limit(1);
    return row ? castSession(row) : null;
  }
  return Array.from(memSessions.values()).find(s => s.join_code === code) || null;
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
  let owner_email: string | null = null;
  if (s.created_by != null) {
    const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, s.created_by)).limit(1);
    owner_email = owner?.email ?? null;
  }
  return { ...castSession(s), progress: total > 0 ? Math.round((checked / total) * 100) : 0, total, checked, display_columns: cols.map(c => c.column_name), owner_email };
}

export async function listSessions(userId: number): Promise<SessionWithProgress[]> {
  if (dbAvailable) {
    const db = getDb();
    const sessions = await db.select().from(pcountSessions);
    sessions.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return Promise.all(sessions.map(async (s) => {
      const withProgress = await dbSessionWithProgress(s);
      return { ...withProgress, is_owner: s.created_by === userId, joined: s.created_by === userId || await isMember(s.id, userId) };
    }));
  }
  const sessions = Array.from(memSessions.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return sessions.map(s => {
    const prods = Array.from(memProducts.values()).filter(p => p.session_id === s.id);
    const total = prods.length;
    const checked = prods.filter(p => p.status !== 'pending').length;
    return { ...s, progress: total > 0 ? Math.round((checked / total) * 100) : 0, total, checked, display_columns: memDisplayColumns.get(s.id) || [], is_owner: s.created_by === userId, joined: s.created_by === userId || memMembers.get(s.id)?.has(userId) || false };
  });
}

export async function searchSessions(q: string, userId: number): Promise<SessionWithProgress[]> {
  const query = q.trim();
  if (query.length === 0) return [];

  if (dbAvailable) {
    const db = getDb();
    const nameLike = `%${query}%`;

    const byName = await db.select().from(pcountSessions).where(like(pcountSessions.name, nameLike));

    let byCode: typeof pcountSessions.$inferSelect | undefined;
    const found = await findSessionByCode(query);
    if (found) {
      const [row] = await db.select().from(pcountSessions).where(eq(pcountSessions.id, found.id)).limit(1);
      byCode = row;
    }

    const sessions = [...byName];
    if (byCode && !sessions.some(s => s.id === byCode.id)) {
      sessions.push(byCode);
    }

    const unique = Array.from(new Map(sessions.map(s => [s.id, s])).values());
    return Promise.all(unique.map(async (s) => {
      const withProgress = await dbSessionWithProgress(s);
      return { ...withProgress, is_owner: s.created_by === userId, joined: await isMember(s.id, userId) };
    }));
  }

  const byName = Array.from(memSessions.values())
    .filter(s => s.name.toLowerCase().includes(query.toLowerCase()));
  const byCode = Array.from(memSessions.values()).find(s => s.join_code === query);
  const sessions = [...byName];
  if (byCode && !sessions.some(s => s.id === byCode.id)) sessions.push(byCode);
  return sessions.map(s => {
    const prods = Array.from(memProducts.values()).filter(p => p.session_id === s.id);
    const total = prods.length;
    const checked = prods.filter(p => p.status !== 'pending').length;
    return { ...s, progress: total > 0 ? Math.round((checked / total) * 100) : 0, total, checked, display_columns: memDisplayColumns.get(s.id) || [], is_owner: s.created_by === userId, joined: memMembers.get(s.id)?.has(userId) || s.created_by === userId };
  });
}

export async function getSession(id: number, userId?: number): Promise<SessionWithProgress | null> {
  if (dbAvailable) {
    const db = getDb();
    const [row] = await db.select().from(pcountSessions).where(eq(pcountSessions.id, id));
    if (!row) return null;
    const withProgress = await dbSessionWithProgress(row);
    return {
      ...withProgress,
      is_owner: userId !== undefined && row.created_by === userId,
      joined: userId !== undefined && (row.created_by === userId || await isMember(id, userId)),
    };
  }
  const row = memSessions.get(id);
  if (!row) return null;
  const prods = Array.from(memProducts.values()).filter(p => p.session_id === id);
  const total = prods.length;
  const checked = prods.filter(p => p.status !== 'pending').length;
  return { ...row, progress: total > 0 ? Math.round((checked / total) * 100) : 0, total, checked, display_columns: memDisplayColumns.get(id) || [], is_owner: userId !== undefined && row.created_by === userId, joined: userId !== undefined && (row.created_by === userId || memMembers.get(id)?.has(userId)) };
}

export async function submitSession(id: number, userId: number): Promise<SessionRow | null> {
  await assertMember(id, userId);

  if (dbAvailable) {
    const db = getDb();
    await db.update(pcountSessions).set({ submitted_at: new Date(), submitted_by: userId }).where(eq(pcountSessions.id, id));
    const [row] = await db.select().from(pcountSessions).where(eq(pcountSessions.id, id));
    return castSession(row);
  }
  const existing = memSessions.get(id);
  if (!existing) return null;
  const updated = { ...existing, submitted_at: memNow(), submitted_by: userId, updated_at: memNow() };
  memSessions.set(id, updated);
  return updated;
}

export async function reopenSession(id: number, userId: number): Promise<SessionRow | null> {
  await assertOwner(id, userId);

  if (dbAvailable) {
    const db = getDb();
    await db.update(pcountSessions).set({ submitted_at: null, submitted_by: null }).where(eq(pcountSessions.id, id));
    const [row] = await db.select().from(pcountSessions).where(eq(pcountSessions.id, id));
    return castSession(row);
  }
  const existing = memSessions.get(id);
  if (!existing) return null;
  const updated = { ...existing, submitted_at: null, submitted_by: null, updated_at: memNow() };
  memSessions.set(id, updated);
  return updated;
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
  memMembers.delete(id);
  for (const [pid, p] of memProducts) {
    if (p.session_id === id) { memProducts.delete(pid); memProductExtras.delete(pid); }
  }
}

export async function deleteSessionProducts(sessionId: number): Promise<void> {
  if (dbAvailable) {
    const pool = getDbPool();
    await pool.execute(
      `DELETE FROM pcount_product_extra WHERE product_id IN (SELECT id FROM pcount_products WHERE session_id = ?)`,
      [sessionId]
    );
    await pool.execute(`DELETE FROM pcount_products WHERE session_id = ?`, [sessionId]);
    return;
  }
  for (const [pid, p] of memProducts) {
    if (p.session_id === sessionId) { memProducts.delete(pid); memProductExtras.delete(pid); }
  }
}

export async function setDisplayColumns(sessionId: number, columns: string[]): Promise<void> {
  if (dbAvailable) {
    const pool = getDbPool();
    await pool.execute(`DELETE FROM pcount_display_columns WHERE session_id = ?`, [sessionId]);
    if (columns.length > 0) {
      const placeholders = columns.map(() => '(?,?)').join(',');
      const params: any[] = [];
      for (const col of columns) params.push(sessionId, col);
      await pool.execute(
        `INSERT INTO pcount_display_columns (session_id,column_name) VALUES ${placeholders}`,
        params
      );
    }
    return;
  }
  memDisplayColumns.set(sessionId, columns);
}

export async function listProducts(sessionId: number, opts?: { status?: string; sort?: string }): Promise<ProductWithExtra[]> {
  if (dbAvailable) return dbListProducts(sessionId, opts);
  return memListProducts(sessionId, opts);
}

function productBrand(product: ProductWithExtra | undefined): string {
  if (!product) return '';
  return Object.entries(product.extra || {}).find(([key]) => key.trim().toLowerCase() === 'brand')?.[1]?.trim() || '';
}

function productCategory(product: ProductWithExtra | undefined): string {
  if (!product) return '';
  return productBrand(product).toLowerCase().includes('apple') ? 'Apple' : '3PP';
}

export async function compareProducts(currentSessionId: number, previousSessionId: number): Promise<ProductComparisonRow[]> {
  const [currentProducts, previousProducts] = await Promise.all([
    listProducts(currentSessionId),
    listProducts(previousSessionId),
  ]);
  const currentByCode = new Map(currentProducts.map(product => [product.product_code.trim().toUpperCase(), product]));
  const previousByCode = new Map(previousProducts.map(product => [product.product_code.trim().toUpperCase(), product]));
  const codes = new Set([...currentByCode.keys(), ...previousByCode.keys()]);

  return Array.from(codes).filter(code => {
    const current = currentByCode.get(code);
    const previous = previousByCode.get(code);
    return current?.status !== 'excluded' && previous?.status !== 'excluded';
  }).map(code => {
    const current = currentByCode.get(code);
    const previous = previousByCode.get(code);
    const currentCount = current?.counted_qty || 0;
    const previousCount = previous?.counted_qty || 0;
    const description = current?.description || previous?.description || '';
    const brand = productBrand(current) || productBrand(previous);
    const previousCategory = productCategory(previous);
    const currentCategory = productCategory(current);
    const categoryChanged = Boolean(current && previous && previousCategory !== currentCategory);
    const sameDetails = current && previous
      && currentCount === previousCount
      && current.status === previous.status
      && description === (previous.description || '')
      && brand === productBrand(previous)
      && !categoryChanged;
    const change: ProductComparisonRow['change'] = !previous
      ? 'added'
      : !current
        ? 'removed'
        : sameDetails
          ? 'unchanged'
          : 'changed';

    return {
      product_code: current?.product_code || previous?.product_code || code,
      description,
      brand,
      previous_category: previousCategory,
      current_category: currentCategory,
      category_changed: categoryChanged,
      previous_count: previousCount,
      current_count: currentCount,
      difference: currentCount - previousCount,
      previous_status: previous?.status || null,
      current_status: current?.status || null,
      change,
    };
  }).sort((a, b) => a.product_code.localeCompare(b.product_code));
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

export async function bulkUpdateProducts(
  sessionId: number,
  codes: string[],
  action: 'complete' | 'exclude',
): Promise<{ products: ProductWithExtra[]; missingCodes: string[] }> {
  const requested = Array.from(new Set(codes.map(code => code.trim()).filter(Boolean)));
  if (requested.length === 0) return { products: [], missingCodes: [] };

  if (dbAvailable) {
    const db = getDb();
    const rows = await db
      .select({ product_code: pcountProducts.product_code })
      .from(pcountProducts)
      .where(eq(pcountProducts.session_id, sessionId));
    const actualByNormalizedCode = new Map(rows.map(row => [row.product_code.trim().toUpperCase(), row.product_code]));
    const matchedCodes = requested
      .map(code => actualByNormalizedCode.get(code.toUpperCase()))
      .filter((code): code is string => Boolean(code));
    const matchedSet = new Set(matchedCodes);

    if (matchedCodes.length > 0) {
      if (action === 'complete') {
        await db.update(pcountProducts).set({
          counted_qty: sql`${pcountProducts.system_qty}`,
          status: 'matched',
        }).where(and(
          eq(pcountProducts.session_id, sessionId),
          inArray(pcountProducts.product_code, matchedCodes),
          sql`${pcountProducts.status} <> 'excluded'`,
        ));
      } else {
        await db.update(pcountProducts).set({ status: 'excluded' }).where(and(
          eq(pcountProducts.session_id, sessionId),
          inArray(pcountProducts.product_code, matchedCodes),
        ));
      }
    }

    const updatedCodeSet = new Set(matchedCodes);
    return {
      products: matchedCodes.length > 0
        ? (await dbListProducts(sessionId)).filter(product => updatedCodeSet.has(product.product_code))
        : [],
      missingCodes: requested.filter(code => !matchedSet.has(actualByNormalizedCode.get(code.toUpperCase()) || '')),
    };
  }

  const actualByNormalizedCode = new Map(
    Array.from(memProducts.values())
      .filter(product => product.session_id === sessionId)
      .map(product => [product.product_code.trim().toUpperCase(), product]),
  );
  const updatedProducts: ProductWithExtra[] = [];
  const matchedCodes = new Set<string>();
  for (const code of requested) {
    const product = actualByNormalizedCode.get(code.toUpperCase());
    if (!product) continue;
    matchedCodes.add(product.product_code);
    if (action === 'complete' && product.status !== 'excluded') {
      product.counted_qty = product.system_qty;
      product.status = 'matched';
    } else if (action === 'exclude') {
      product.status = 'excluded';
    }
    memProducts.set(product.id, product);
    updatedProducts.push({ ...product, extra: memProductExtras.get(product.id) || {} });
  }

  return {
    products: updatedProducts,
    missingCodes: requested.filter(code => !matchedCodes.has(actualByNormalizedCode.get(code.toUpperCase())?.product_code || '')),
  };
}

export async function createProducts(sessionId: number, products: { product_code: string; description: string; system_qty: number; extra?: Record<string, string> }[]): Promise<number> {
  if (products.length === 0) return 0;

  if (dbAvailable) {
    const pool = getDbPool();
    const batchSize = 1000;
    const extraBatchSize = 2000;

    const allExtraRows: { product_id: number; column_name: string; column_value: string }[] = [];
    const codeToId = new Map<string, number>();

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (let i = 0; i < products.length; i += batchSize) {
        const batch = products.slice(i, i + batchSize);

        const placeholders = batch.map(() => '(?,?,?,?,?,?,?)').join(',');
        const params: any[] = [];
        for (const p of batch) {
          params.push(sessionId, p.product_code, p.description || '', parseCategory(p.product_code, p.extra), p.system_qty || 0, 0, 'pending');
        }

        const [rows] = await conn.execute(
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

      for (let i = 0; i < allExtraRows.length; i += extraBatchSize) {
        const batch = allExtraRows.slice(i, i + extraBatchSize);
        const placeholders = batch.map(() => '(?,?,?)').join(',');
        const params: any[] = [];
        for (const r of batch) {
          params.push(r.product_id, r.column_name, r.column_value);
        }
        await conn.execute(`INSERT INTO pcount_product_extra (product_id,column_name,column_value) VALUES ${placeholders}`, params);
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } else {
    for (const p of products) {
      const id = nextProductId++;
      memProducts.set(id, {
        id, session_id: sessionId,
        product_code: p.product_code,
        description: p.description || '',
        category: parseCategory(p.product_code, p.extra),
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
          status = 'matched';
        } else {
          status = 'missing';
        }
        updates.push({ code: ep.product_code, counted_qty: countedQty, status });
        matched++;
      }
    }

    if (updates.length > 0) {
      const pool = getDbPool();
      const qtyWhens = updates.map(() => 'WHEN ? THEN ?').join(' ');
      const statusWhens = updates.map(() => 'WHEN ? THEN ?').join(' ');
      const params: any[] = [];
      for (const u of updates) params.push(u.code, u.counted_qty);
      for (const u of updates) params.push(u.code, u.status);
      params.push(sessionId);
      await pool.execute(
        `UPDATE pcount_products SET counted_qty = CASE product_code ${qtyWhens} END, status = CASE product_code ${statusWhens} END WHERE session_id = ?`,
        params
      );
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
          status = 'matched';
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
         WHEN status IN ('pending', 'missing', 'matched') THEN COALESCE(counted_qty, 0) + 1
         ELSE COALESCE(counted_qty, 0)
       END,
       status = CASE
         WHEN status IN ('pending', 'missing', 'matched') AND COALESCE(counted_qty, 0) + 1 >= system_qty THEN 'matched'
         WHEN status IN ('pending', 'missing', 'matched') THEN 'missing'
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

  if (['pending', 'missing', 'matched'].includes(product.status)) {
    newCounted = product.counted_qty + 1;
    newStatus = newCounted >= product.system_qty ? 'matched' : 'missing';
  }

  const isMatch = newCounted === product.system_qty;

  if (newCounted !== product.counted_qty || newStatus !== product.status) {
    const updated = await updateProduct(sessionId, product_code, { counted_qty: newCounted, status: newStatus });
    if (updated) return { product: updated, match: isMatch };
  }

  return { product, match: isMatch };
}

function parseCategory(code: string, extra?: Record<string, string>): string {
  const brand = extra?.Brand || extra?.brand || '';
  if (brand.toLowerCase().includes('apple')) return 'apple';
  if (brand.trim()) return '3pp';
  const u = code.toUpperCase();
  if (u.startsWith('APP') || u.startsWith('APL')) return 'apple';
  if (u.startsWith('3PP') || u.startsWith('THR')) return '3pp';
  return '';
}

export async function hasScannedProducts(sessionId: number): Promise<boolean> {
  const products = await listProducts(sessionId);
  return products.some(p => p.counted_qty > 0);
}

export async function adminListSessions(): Promise<(SessionWithProgress & { member_count: number })[]> {
  if (!dbAvailable) throw new PcountError(503, 'Database unavailable');
  const db = getDb();
  const pool = getDbPool();
  const sessions = await db.select().from(pcountSessions).orderBy(desc(pcountSessions.created_at));
  return Promise.all(sessions.map(async (s) => {
    const withProgress = await dbSessionWithProgress(s);
    const [rows] = await pool.execute('SELECT COUNT(*) as c FROM pcount_session_members WHERE session_id = ?', [s.id]);
    const member_count = Number((rows as any[])[0]?.c || 0);
    return { ...withProgress, member_count };
  }));
}

export async function adminGetSession(sessionId: number): Promise<SessionWithProgress | null> {
  if (!dbAvailable) throw new PcountError(503, 'Database unavailable');
  const db = getDb();
  const [row] = await db.select().from(pcountSessions).where(eq(pcountSessions.id, sessionId));
  if (!row) return null;
  return dbSessionWithProgress(row);
}

export async function adminListSessionProducts(sessionId: number): Promise<ProductWithExtra[]> {
  if (!dbAvailable) throw new PcountError(503, 'Database unavailable');
  return dbListProducts(sessionId);
}

export async function adminGetUser(userId: number): Promise<{ id: number; email: string } | null> {
  if (!dbAvailable) return null;
  const db = getDb();
  const [row] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return row || null;
}
