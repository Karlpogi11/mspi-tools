import { getDb } from './index.js';
import { auditLog } from './schema.js';
import { logger } from '../logger.js';

export interface AuditEvent {
  actorUserId?: number | null;
  action: string;
  resourceType: string;
  resourceId?: string | number | null;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(event: AuditEvent): Promise<void> {
  try {
    await getDb().insert(auditLog).values({
      actor_user_id: event.actorUserId ?? null,
      action: event.action,
      resource_type: event.resourceType,
      resource_id: event.resourceId == null ? null : String(event.resourceId),
      metadata: event.metadata ? JSON.stringify(event.metadata) : null,
    });
  } catch (error) {
    logger.warn({ err: error, action: event.action }, 'Audit log write failed');
  }
}
