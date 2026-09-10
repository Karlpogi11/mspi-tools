import type { PoolConnection } from 'mysql2/promise';
import { DIVISIONS, type Division, QueueError, dayBounds, divisionQueue, requireCurrentQueue, recordTurn, withQueue } from './queue.js';
import { resolveDivision } from './queue.js';

export interface AssignmentInput {
  arNumber?: unknown;
  frontlineRecordId?: unknown;
  deviceModel?: unknown;
  division?: unknown;
  queueToken?: unknown;
}
export async function lookupAssignment(connection: PoolConnection, input: AssignmentInput) {
  const arNumber = String(input.arNumber ?? '').trim();
  if (!arNumber || arNumber.length > 100 || arNumber.toUpperCase() === 'N/A') throw new QueueError(400, 'Enter a valid Frontline AR number.');
  const recordId = Number(input.frontlineRecordId) || null;
  const [records] = await connection.query(`SELECT id, ar_number, device_model, issue, product_division FROM frontline_records
    WHERE ${recordId ? 'id = ?' : 'ar_number = ?'} ORDER BY id DESC LIMIT 1`, [recordId || arNumber]);
  const record = (records as Array<{ id: number; ar_number: string; device_model: string; issue: string; product_division: string }>)[0];
  if (!record) throw new QueueError(404, 'Frontline record not found for this AR number.');
  if (recordId && record.ar_number.trim().toUpperCase() !== 'N/A' && record.ar_number.trim().toUpperCase() !== arNumber.toUpperCase()) throw new QueueError(409, 'The AR number does not match the selected Frontline record.');
  const [existing] = await connection.query('SELECT engineer_name FROM engineer_endorsements WHERE ar_number = ? OR frontline_record_id = ? LIMIT 1', [arNumber, record.id]);
  if ((existing as unknown[]).length) throw new QueueError(409, `This AR is already endorsed to ${(existing as Array<{ engineer_name: string }>)[0].engineer_name}.`);
  const deviceModel = String(input.deviceModel ?? record.device_model ?? '').trim();
  if (deviceModel.length > 150) throw new QueueError(400, 'Device model must be at most 150 characters.');
  const detected = resolveDivision(deviceModel, record.product_division);
  const productDivision = detected;
  if (!productDivision) throw new QueueError(400, 'The Frontline unit does not identify an iOS/ACCS, MacBook, or iMac division. Correct the Frontline unit and try again.');
  return { arNumber, frontlineRecordId: Number(record.id), deviceModel, issue: record.issue, productDivision };
}
export async function previewAssignment(input: AssignmentInput) {
  return withQueue(async (connection, date) => {
    const record = await lookupAssignment(connection, input);
    const queue = await divisionQueue(connection, date, record.productDivision);
    return { record, queue, date };
  }, false);
}
export async function assignNext(input: AssignmentInput, actorUserId: number, expectedEngineerName?: string) {
  return withQueue(async (connection, date) => {
    const record = await lookupAssignment(connection, input);
    const queue = await divisionQueue(connection, date, record.productDivision);
    const engineer = requireCurrentQueue(queue, input.queueToken);
    if (expectedEngineerName && engineer.full_name !== expectedEngineerName) throw new QueueError(409, 'This Engineer is not next. Use Assign next to review the current rotation.');
    const [result] = await connection.execute(`INSERT INTO engineer_endorsements
      (ar_number, frontline_record_id, cso_user_id, engineer_user_id, engineer_name, device_model, issue, product_division)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [record.arNumber, record.frontlineRecordId, actorUserId, engineer.user_id, engineer.full_name, record.deviceModel, record.issue, record.productDivision]);
    const endorsementId = Number((result as { insertId: number }).insertId);
    await recordTurn(connection, date, record.productDivision, engineer.id, endorsementId, actorUserId);
    return { message: `AR ${record.arNumber} endorsed to ${engineer.full_name} (${record.productDivision}).`, endorsementId, engineer: { userId: engineer.user_id, name: engineer.full_name }, record };
  });
}
export async function assignEngineer(input: AssignmentInput, engineerName: unknown, actorUserId: number) {
  const name = String(engineerName ?? '').trim();
  if (!name || name.length > 150) throw new QueueError(400, 'Choose an available Engineer.');
  return withQueue(async (connection, date) => {
    const record = await lookupAssignment(connection, input);
    const queue = await divisionQueue(connection, date, record.productDivision);
    // Same freshness guarantee as next-assign, without requiring the turn.
    if (typeof input.queueToken !== 'string' || input.queueToken !== queue.token) throw new QueueError(409, 'The queue changed. Review the Engineers again before confirming.');
    const engineer = queue.engineers.find((row) => row.full_name === name);
    if (!engineer) throw new QueueError(409, 'Choose an Engineer who is available today.');
    const [result] = await connection.execute(`INSERT INTO engineer_endorsements
      (ar_number, frontline_record_id, cso_user_id, engineer_user_id, engineer_name, device_model, issue, product_division)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [record.arNumber, record.frontlineRecordId, actorUserId, engineer.user_id, engineer.full_name, record.deviceModel, record.issue, record.productDivision]);
    const endorsementId = Number((result as { insertId: number }).insertId);
    // A manual pick still records a turn, so the rotation rebalances after it.
    await recordTurn(connection, date, record.productDivision, engineer.id, endorsementId, actorUserId);
    return { message: `AR ${record.arNumber} endorsed to ${engineer.full_name} (${record.productDivision}).`, endorsementId, engineer: { userId: engineer.user_id, name: engineer.full_name }, record };
  });
}
export async function skipNext(division: unknown, reason: unknown, token: unknown, actorUserId: number, ownUserId?: number) {
  if (!DIVISIONS.includes(division as Division)) throw new QueueError(400, 'Choose a valid division.');
  const note = String(reason ?? '').trim();
  if (!note || note.length > 300) throw new QueueError(400, 'Enter a skip reason (up to 300 characters).');
  return withQueue(async (connection, date) => {
    const queue = await divisionQueue(connection, date, division as Division);
    const engineer = requireCurrentQueue(queue, token);
    if (ownUserId && engineer.user_id !== ownUserId) throw new QueueError(409, 'It is not your turn in this division.');
    if (queue.engineers.length < 2) throw new QueueError(409, 'There is no other available Engineer. Use Away if you cannot accept work.');
    await recordTurn(connection, date, division as Division, engineer.id, null, actorUserId, note);
    return { message: `${engineer.full_name}'s ${division} turn was skipped.`, engineer: engineer.full_name };
  });
}

export async function reorderQueue(division: unknown, engineerIds: unknown, token: unknown, actorUserId: number) {
  if (!DIVISIONS.includes(division as Division)) throw new QueueError(400, 'Choose a valid division.');
  const selectedDivision = division as Division;
  if (!Array.isArray(engineerIds) || engineerIds.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) < 1)) {
    throw new QueueError(400, 'Provide a valid Engineer order.');
  }
  const requestedIds = engineerIds.map(Number);
  if (!requestedIds.length) throw new QueueError(400, 'Provide a valid Engineer order.');
  if (new Set(requestedIds).size !== requestedIds.length) throw new QueueError(400, 'Engineer order contains duplicates.');
  return withQueue(async (connection, date) => {
    const queue = await divisionQueue(connection, date, selectedDivision);
    requireCurrentQueue(queue, token);
    const currentIds = queue.engineers.map((engineer) => engineer.id);
    if (requestedIds.length !== currentIds.length || requestedIds.some((id) => !currentIds.includes(id))) {
      throw new QueueError(409, 'The available Engineers changed. Refresh and arrange the queue again.');
    }
    const [awayRows] = await connection.query(`SELECT id FROM engineer_daily_availability
      WHERE availability_date = ? AND status <> 'active' AND id NOT IN (${requestedIds.map(() => '?').join(',')})
      ORDER BY joined_at, id`, [date, ...requestedIds]);
    const orderedIds = [...requestedIds, ...(awayRows as Array<{ id: number }>).map((row) => Number(row.id))];
    for (const availabilityId of orderedIds) {
      await connection.execute(`INSERT INTO engineer_queue_events
        (queue_date, product_division, availability_id, event_type, actor_user_id)
        VALUES (?, ?, ?, 'reordered', ?)`, [date, selectedDivision, availabilityId, actorUserId]);
    }
    return { message: `${selectedDivision} Engineer order updated.` };
  });
}

interface ExistingEndorsement { id: number; engineer_name: string; engineer_user_id: number | null; created_at: Date; device_model: string; product_division: string }
async function existingEndorsement(connection: PoolConnection, id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new QueueError(400, 'A valid endorsement is required.');
  const [rows] = await connection.query('SELECT id, engineer_name, engineer_user_id, created_at, device_model, product_division FROM engineer_endorsements WHERE id = ? FOR UPDATE', [id]);
  const row = (rows as ExistingEndorsement[])[0];
  if (!row) throw new QueueError(404, 'Endorsement record not found.');
  return row;
}
function isToday(createdAt: Date, date: string) {
  const [start, end] = dayBounds(date);
  return createdAt >= start && createdAt < end;
}
export async function changeEngineer(id: number, name: string | null, actorUserId: number) {
  return withQueue(async (connection, date) => {
    const row = await existingEndorsement(connection, id);
    const division = resolveDivision(row.device_model, row.product_division);
    if (!division) throw new QueueError(400, 'Correct the device model before changing this assignment.');
    let targetName = name;
    if (targetName === null) {
      const queue = await divisionQueue(connection, date, division);
      if (!isToday(row.created_at, date)) throw new QueueError(409, 'Only today\'s endorsements can be passed.');
      const [latest] = await connection.query('SELECT id FROM engineer_endorsements WHERE product_division = ? ORDER BY created_at DESC, id DESC LIMIT 1', [row.product_division]);
      if (Number((latest as Array<{ id: number }>)[0]?.id) !== id) throw new QueueError(409, 'Only the newest endorsement in this division can be passed.');
      targetName = queue.engineers.find((engineer) => engineer.full_name !== row.engineer_name)?.full_name || '';
    }
    const [targets] = await connection.query(`SELECT r.user_id, r.engineer_name, a.id, a.status
      FROM engineer_roster r JOIN engineer_daily_availability a ON a.engineer_name = r.engineer_name AND a.availability_date = ?
      WHERE r.active = 1 AND r.engineer_name = ? LIMIT 1`, [date, targetName]);
    const target = (targets as Array<{ id: number; user_id: number | null; engineer_name: string; status: string }>)[0];
    if (!target) throw new QueueError(409, 'Choose an Engineer from the active roster.');
    if (isToday(row.created_at, date) && target.status !== 'active') throw new QueueError(409, 'Choose an Engineer who is available today.');
    if (target.engineer_name === row.engineer_name) return { message: 'Engineer assignment unchanged.', engineer: target.engineer_name, fromEngineer: row.engineer_name };
    await connection.execute('UPDATE engineer_endorsements SET engineer_user_id = ?, engineer_name = ? WHERE id = ?', [target.user_id, target.engineer_name, id]);
    // Removing the old event restores that Engineer's previous turn, including any skips.
    await connection.execute('DELETE FROM engineer_queue_events WHERE endorsement_id = ?', [id]);
    if (isToday(row.created_at, date)) await recordTurn(connection, date, division, Number(target.id), id, actorUserId);
    return { message: `Endorsement assigned to ${target.engineer_name}.`, engineer: target.engineer_name, fromEngineer: row.engineer_name };
  });
}
export async function removeEndorsement(id: number, cancel = false) {
  return withQueue(async (connection) => {
    const row = await existingEndorsement(connection, id);
    if (cancel && Date.now() - row.created_at.getTime() > 5000) throw new QueueError(409, 'The 5-second cancel window has expired.');
    await connection.execute('DELETE FROM engineer_endorsements WHERE id = ?', [id]);
    return { message: cancel ? 'Endorsement cancelled.' : 'Endorsement deleted. The Frontline record was not changed.', engineerName: row.engineer_name };
  });
}
export async function changeDeviceModel(id: number, deviceModel: string, actorUserId: number) {
  if (!deviceModel || deviceModel.length > 150) throw new QueueError(400, 'Enter a device model (up to 150 characters).');
  return withQueue(async (connection, date) => {
    const row = await existingEndorsement(connection, id);
    const division = resolveDivision(deviceModel, row.product_division);
    if (!division) throw new QueueError(400, 'The device model must belong to iOS/ACCS, MacBook, or iMac.');
    await connection.execute('UPDATE engineer_endorsements SET device_model = ?, product_division = ? WHERE id = ?', [deviceModel, division, id]);
    const [events] = await connection.query('SELECT id FROM engineer_queue_events WHERE endorsement_id = ?', [id]);
    if ((events as unknown[]).length) await connection.execute('UPDATE engineer_queue_events SET product_division = ? WHERE endorsement_id = ?', [division, id]);
    else if (isToday(row.created_at, date)) {
      const [availability] = await connection.query('SELECT id FROM engineer_daily_availability WHERE availability_date = ? AND engineer_name = ?', [date, row.engineer_name]);
      const engineer = (availability as Array<{ id: number }>)[0];
      if (engineer) await recordTurn(connection, date, division, Number(engineer.id), id, actorUserId);
    }
    return { message: 'Device model updated.', deviceModel, productDivision: division };
  });
}
