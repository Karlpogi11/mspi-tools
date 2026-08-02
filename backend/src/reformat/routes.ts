import { Router, Request, Response } from 'express';
import { eq, and, like, desc } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { users, reformatTemplates, reformatTemplateShares } from '../db/schema.js';
import { authenticateToken } from '../auth.js';

const router = Router();

router.use(authenticateToken);

interface ColumnDef {
  name: string;
  source: string;
  constant: string;
}

function parseColumns(raw: unknown): ColumnDef[] | null {
  if (!Array.isArray(raw)) return null;
  const columns: ColumnDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const col = item as Record<string, unknown>;
    const name = typeof col.name === 'string' ? col.name.trim() : '';
    const source = typeof col.source === 'string' ? col.source.trim() : '';
    const constant = typeof col.constant === 'string' ? col.constant : '';
    if (!name || name.length > 255) return null;
    columns.push({ name, source, constant });
  }
  if (columns.length === 0) return null;
  return columns;
}

function parseRemovedColumns(raw: unknown): ColumnDef[] | null {
  if (!Array.isArray(raw)) return null;
  const columns: ColumnDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const col = item as Record<string, unknown>;
    const name = typeof col.name === 'string' ? col.name.trim() : '';
    const source = typeof col.source === 'string' ? col.source.trim() : '';
    const constant = typeof col.constant === 'string' ? col.constant : '';
    if (!name || name.length > 255) return null;
    columns.push({ name, source, constant });
  }
  return columns;
}

function serializeTemplate(row: any, userId: number) {
  let columns: ColumnDef[] = [];
  if (row.columns) {
    try {
      const parsed = JSON.parse(row.columns);
      if (Array.isArray(parsed)) columns = parsed;
    } catch {}
  }
  let removedColumns: ColumnDef[] = [];
  if (row.removed_columns) {
    try {
      const parsed = JSON.parse(row.removed_columns);
      if (Array.isArray(parsed)) removedColumns = parsed;
    } catch {}
  }
  return {
    id: row.id,
    name: row.name,
    header_row: row.header_row,
    columns,
    removed_columns: removedColumns,
    created_by: row.created_by,
    is_owner: row.created_by === userId,
    owner_email: row.owner_email ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getTemplate(id: number) {
  const db = getDb();
  const [row] = await db
    .select({
      id: reformatTemplates.id,
      name: reformatTemplates.name,
      header_row: reformatTemplates.header_row,
      columns: reformatTemplates.columns,
      removed_columns: reformatTemplates.removed_columns,
      created_by: reformatTemplates.created_by,
      created_at: reformatTemplates.created_at,
      updated_at: reformatTemplates.updated_at,
      owner_email: users.email,
    })
    .from(reformatTemplates)
    .leftJoin(users, eq(users.id, reformatTemplates.created_by))
    .where(eq(reformatTemplates.id, id));
  return row;
}

router.get('/templates', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;

    const owned = await db
      .select({
        id: reformatTemplates.id,
        name: reformatTemplates.name,
        header_row: reformatTemplates.header_row,
        columns: reformatTemplates.columns,
        removed_columns: reformatTemplates.removed_columns,
        created_by: reformatTemplates.created_by,
        created_at: reformatTemplates.created_at,
        updated_at: reformatTemplates.updated_at,
        owner_email: users.email,
      })
      .from(reformatTemplates)
      .leftJoin(users, eq(users.id, reformatTemplates.created_by))
      .where(eq(reformatTemplates.created_by, userId))
      .orderBy(desc(reformatTemplates.updated_at));

    const shared = await db
      .select({
        id: reformatTemplates.id,
        name: reformatTemplates.name,
        header_row: reformatTemplates.header_row,
        columns: reformatTemplates.columns,
        removed_columns: reformatTemplates.removed_columns,
        created_by: reformatTemplates.created_by,
        created_at: reformatTemplates.created_at,
        updated_at: reformatTemplates.updated_at,
        owner_email: users.email,
      })
      .from(reformatTemplateShares)
      .innerJoin(reformatTemplates, eq(reformatTemplateShares.template_id, reformatTemplates.id))
      .innerJoin(users, eq(reformatTemplates.created_by, users.id))
      .where(eq(reformatTemplateShares.user_id, userId))
      .orderBy(desc(reformatTemplates.updated_at));

    res.json({
      owned: owned.map((row) => serializeTemplate(row, userId)),
      shared: shared.map((row) => serializeTemplate(row, userId)),
    });
  } catch (error) {
    console.error('reformat list error:', error);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

router.post('/templates', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, header_row, columns, removed_columns } = req.body ?? {};
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) {
      res.status(400).json({ error: 'Template name is required' });
      return;
    }
    const parsed = parseColumns(columns);
    if (!parsed) {
      res.status(400).json({ error: 'At least one column mapping is required' });
      return;
    }
    const parsedRemoved = removed_columns !== undefined ? parseRemovedColumns(removed_columns) : [];
    if (parsedRemoved === null) {
      res.status(400).json({ error: 'Invalid removed columns' });
      return;
    }
    const headerRow = Math.max(1, parseInt(header_row) || 1);

    const [id] = await db
      .insert(reformatTemplates)
      .values({
        name: cleanName,
        header_row: headerRow,
        columns: JSON.stringify(parsed),
        removed_columns: parsedRemoved.length > 0 ? JSON.stringify(parsedRemoved) : null,
        created_by: req.user!.userId,
      })
      .$returningId();

    const row = await getTemplate(id.id);
    res.status(201).json(serializeTemplate(row, req.user!.userId));
  } catch (error) {
    console.error('reformat create error:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

async function requireOwner(req: Request, res: Response, id: number) {
  const row = await getTemplate(id);
  if (!row) {
    res.status(404).json({ error: 'Template not found' });
    return null;
  }
  if (row.created_by !== req.user!.userId) {
    res.status(403).json({ error: 'Only the owner can modify this template' });
    return null;
  }
  return row;
}

router.get('/templates/:id', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const row = await getTemplate(id);
    if (!row) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    if (row.created_by !== req.user!.userId) {
      const [share] = await db
        .select({ userId: reformatTemplateShares.user_id })
        .from(reformatTemplateShares)
        .where(
          and(
            eq(reformatTemplateShares.template_id, id),
            eq(reformatTemplateShares.user_id, req.user!.userId)
          )
        );
      if (!share) {
        res.status(403).json({ error: 'This template is not shared with you' });
        return;
      }
    }
    res.json(serializeTemplate(row, req.user!.userId));
  } catch (error) {
    console.error('reformat get error:', error);
    res.status(500).json({ error: 'Failed to get template' });
  }
});

router.put('/templates/:id', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const row = await requireOwner(req, res, id);
    if (!row) return;

    const { name, header_row, columns, removed_columns } = req.body ?? {};
    const update: Record<string, unknown> = {};
    if (name !== undefined) {
      const cleanName = String(name).trim();
      if (!cleanName) {
        res.status(400).json({ error: 'Template name is required' });
        return;
      }
      update.name = cleanName;
    }
    if (columns !== undefined) {
      const parsed = parseColumns(columns);
      if (!parsed) {
        res.status(400).json({ error: 'At least one column mapping is required' });
        return;
      }
      update.columns = JSON.stringify(parsed);
    }
    if (removed_columns !== undefined) {
      const parsedRemoved = parseRemovedColumns(removed_columns);
      if (parsedRemoved === null) {
        res.status(400).json({ error: 'Invalid removed columns' });
        return;
      }
      update.removed_columns = parsedRemoved.length > 0 ? JSON.stringify(parsedRemoved) : null;
    }
    if (header_row !== undefined) {
      update.header_row = Math.max(1, parseInt(header_row) || 1);
    }

    await db.update(reformatTemplates).set(update).where(eq(reformatTemplates.id, id));
    const updated = await getTemplate(id);
    res.json(serializeTemplate(updated, req.user!.userId));
  } catch (error) {
    console.error('reformat update error:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

router.delete('/templates/:id', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const row = await requireOwner(req, res, id);
    if (!row) return;
    await db.delete(reformatTemplates).where(eq(reformatTemplates.id, id));
    res.json({ message: 'Template deleted' });
  } catch (error) {
    console.error('reformat delete error:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

router.get('/templates/:id/shares', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const row = await requireOwner(req, res, id);
    if (!row) return;

    const shares = await db
      .select({
        id: users.id,
        email: users.email,
        full_name: users.full_name,
      })
      .from(reformatTemplateShares)
      .innerJoin(users, eq(reformatTemplateShares.user_id, users.id))
      .where(eq(reformatTemplateShares.template_id, id));

    res.json(shares);
  } catch (error) {
    console.error('reformat shares error:', error);
    res.status(500).json({ error: 'Failed to list shares' });
  }
});

router.post('/templates/:id/share', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const row = await requireOwner(req, res, id);
    if (!row) return;

    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const [target] = await db.select().from(users).where(eq(users.email, email));
    if (!target) {
      res.status(404).json({ error: 'No user found with that email' });
      return;
    }
    if (target.id === req.user!.userId) {
      res.status(400).json({ error: 'This template is already yours' });
      return;
    }

    await db
      .insert(reformatTemplateShares)
      .values({ template_id: id, user_id: target.id })
      .onDuplicateKeyUpdate({ set: { user_id: target.id } });

    res.status(201).json({ id: target.id, email: target.email, full_name: target.full_name });
  } catch (error) {
    console.error('reformat share error:', error);
    res.status(500).json({ error: 'Failed to share template' });
  }
});

router.delete('/templates/:id/share/:userId', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const row = await requireOwner(req, res, id);
    if (!row) return;

    const userId = parseInt(req.params.userId);
    await db
      .delete(reformatTemplateShares)
      .where(
        and(
          eq(reformatTemplateShares.template_id, id),
          eq(reformatTemplateShares.user_id, userId)
        )
      );
    res.json({ message: 'Share removed' });
  } catch (error) {
    console.error('reformat unshare error:', error);
    res.status(500).json({ error: 'Failed to remove share' });
  }
});

router.get('/users/search', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      res.json([]);
      return;
    }
    const rows = await db
      .select({ id: users.id, email: users.email, full_name: users.full_name })
      .from(users)
      .where(like(users.email, `%${q}%`))
      .limit(10);
    res.json(rows);
  } catch (error) {
    console.error('reformat user search error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

export default router;
