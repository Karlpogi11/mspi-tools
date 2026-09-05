import { initDb, getDbPool } from '../src/db/index.js';
import { assignNext, changeEngineer, previewAssignment, removeEndorsement, reorderQueue, skipNext } from '../src/endorsements/assignments.js';
import { availableQueues, todayManila, withQueue } from '../src/endorsements/queue.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function names(state: Awaited<ReturnType<typeof availableQueues>>, division: string) {
  return state.queues.find((queue) => queue.division === division)!.engineers.map((engineer) => engineer.full_name);
}

async function run() {
  process.env.DATABASE_URL ||= 'mysql://root@127.0.0.1:33317/mspi_queue_test';
  await initDb();
  const pool = getDbPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id int AUTO_INCREMENT PRIMARY KEY, email varchar(255) NOT NULL UNIQUE, password_hash varchar(255) NOT NULL,
    full_name varchar(255) NOT NULL, role_id int NULL, is_super_admin int NOT NULL DEFAULT 0,
    token_version int NOT NULL DEFAULT 0, created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.execute(`INSERT IGNORE INTO users (id, email, password_hash, full_name) VALUES
    (1, 'queue-admin@example.test', 'x', 'Queue Admin'),
    (2, 'alex@example.test', 'x', 'Alex'), (3, 'bea@example.test', 'x', 'Bea'), (4, 'chen@example.test', 'x', 'Chen')`);
  await availableQueues();
  await pool.execute("DELETE FROM engineer_queue_events WHERE queue_date = ?", [todayManila()]);
  await pool.execute("DELETE FROM engineer_endorsements WHERE ar_number LIKE 'QUEUE-TEST-%'");
  await pool.execute("DELETE FROM frontline_records WHERE ar_number LIKE 'QUEUE-TEST-%'");
  await pool.execute('DELETE FROM engineer_roster');
  await pool.execute('DELETE FROM engineer_daily_availability WHERE availability_date = ?', [todayManila()]);
  await pool.execute('UPDATE engineer_queue_days SET initialized = 1 WHERE queue_date = ?', [todayManila()]);
  await pool.execute("INSERT INTO engineer_roster (user_id, engineer_name) VALUES (2, 'Alex'), (3, 'Bea'), (4, 'Chen')");
  await withQueue(async () => undefined);
  const initial = await availableQueues();
  for (const division of ['iOS/ACCS', 'MacBook', 'iMac']) assert(names(initial, division).join(',') === 'Alex,Bea,Chen', `${division} did not start in a stable order`);
  const initialIosToken = initial.queues.find((queue) => queue.division === 'iOS/ACCS')!.token;
  await pool.execute(`INSERT INTO engineer_calendar_entries (entry_date, product_division, engineer_name, entry_count, details, created_by)
    VALUES (?, 'iOS/ACCS', 'Alex', 5, 'Manual count must not consume a turn', 1)`, [todayManila()]);
  const afterManualCount = await availableQueues();
  assert(afterManualCount.queues.find((queue) => queue.division === 'iOS/ACCS')!.token === initialIosToken, 'manual count changed the round-robin queue');

  const records = [
    ['QUEUE-TEST-IOS-1', 'iPhone 17', 'IPHONE'], ['QUEUE-TEST-IOS-2', 'iPad (A16)', 'IPAD'],
    ['QUEUE-TEST-IOS-3', 'Apple Watch Series 11', 'WATCH'], ['QUEUE-TEST-IOS-4', 'iPhone 16', 'IPHONE'],
    ['QUEUE-TEST-MAC-1', 'MacBook Air 13-inch (M4)', 'PORTABLE'], ['QUEUE-TEST-IMAC-1', 'iMac 24-inch (M4)', 'DESKTOP'],
  ];
  await pool.execute("INSERT IGNORE INTO frontline_sources (id, spreadsheet_id, spreadsheet_name, selected_sheets) VALUES (1, 'queue-test', 'Queue test', '[]')");
  for (const [ar, model, division] of records) await pool.execute(`INSERT INTO frontline_records
    (source_id, source_sheet, source_row, transaction_type, product_division, ar_number, device_model, issue)
    VALUES (1, 'queue-test', ?, 'RECEIVED (WALK-IN)', ?, ?, ?, 'Queue integration test')`, [records.findIndex((r) => r[0] === ar) + 1, division, ar, model]);

  let state = await availableQueues();
  const iosQueue = state.queues.find((queue) => queue.division === 'iOS/ACCS')!;
  await reorderQueue('iOS/ACCS', [iosQueue.engineers[1].id, iosQueue.engineers[0].id, iosQueue.engineers[2].id], iosQueue.token, 1);
  state = await availableQueues();
  assert(names(state, 'iOS/ACCS').join(',') === 'Bea,Alex,Chen', 'manual iOS queue order was not saved');
  assert(names(state, 'MacBook').join(',') === 'Alex,Bea,Chen', 'manual iOS queue order changed MacBook');
  const reorderedQueue = state.queues.find((queue) => queue.division === 'iOS/ACCS')!;
  await reorderQueue('iOS/ACCS', [reorderedQueue.engineers[1].id, reorderedQueue.engineers[0].id, reorderedQueue.engineers[2].id], reorderedQueue.token, 1);

  const iosPreview = await previewAssignment({ arNumber: 'QUEUE-TEST-IOS-1', division: 'iMac' });
  assert(iosPreview.record.productDivision === 'iOS/ACCS', 'recognized Frontline division did not override the selected division');
  const ios1 = await assignNext({ arNumber: 'QUEUE-TEST-IOS-1', queueToken: iosPreview.queue.token }, 1);
  assert(ios1.engineer.name === 'Alex', 'first iOS assignment was not Alex');
  state = await availableQueues();
  assert(names(state, 'iOS/ACCS').join(',') === 'Bea,Chen,Alex', 'iOS queue did not advance');
  assert(names(state, 'MacBook').join(',') === 'Alex,Bea,Chen', 'iOS assignment changed MacBook queue');
  assert(names(state, 'iMac').join(',') === 'Alex,Bea,Chen', 'iOS assignment changed iMac queue');

  const macPreview = await previewAssignment({ arNumber: 'QUEUE-TEST-MAC-1' });
  const mac1 = await assignNext({ arNumber: 'QUEUE-TEST-MAC-1', queueToken: macPreview.queue.token }, 1);
  assert(mac1.engineer.name === 'Alex', 'MacBook did not use its independent next Engineer');
  state = await availableQueues();
  const iosQueue = state.queues.find((queue) => queue.division === 'iOS/ACCS')!;
  await skipNext('iOS/ACCS', 'Engineer is handling a customer', iosQueue.token, 1);
  state = await availableQueues();
  assert(names(state, 'iOS/ACCS').join(',') === 'Chen,Alex,Bea', 'skip did not move only the iOS Engineer to the end');
  assert(state.skips[0]?.reason === 'Engineer is handling a customer', 'skip reason was not retained');

  const stale = await previewAssignment({ arNumber: 'QUEUE-TEST-IOS-2' });
  await withQueue(async (connection, date) => { await connection.execute("UPDATE engineer_daily_availability SET status = 'left' WHERE engineer_name = 'Chen' AND availability_date = ?", [date]); });
  let staleRejected = false;
  try { await assignNext({ arNumber: 'QUEUE-TEST-IOS-2', queueToken: stale.queue.token }, 1); }
  catch (error) { staleRejected = (error as { status?: number }).status === 409; }
  assert(staleRejected, 'stale review was accepted after availability changed');
  await withQueue(async (connection, date) => { await connection.execute("UPDATE engineer_daily_availability SET status = 'active' WHERE engineer_name = 'Chen' AND availability_date = ?", [date]); });

  const concurrentPreview = await previewAssignment({ arNumber: 'QUEUE-TEST-IOS-2' });
  const concurrent = await Promise.allSettled([
    assignNext({ arNumber: 'QUEUE-TEST-IOS-2', queueToken: concurrentPreview.queue.token }, 1),
    assignNext({ arNumber: 'QUEUE-TEST-IOS-3', queueToken: concurrentPreview.queue.token }, 1),
  ]);
  assert(concurrent.filter((result) => result.status === 'fulfilled').length === 1, 'simultaneous submissions created more than one assignment from one review');
  assert(concurrent.filter((result) => result.status === 'rejected').length === 1, 'simultaneous stale submission was not rejected');
  const remainingAr = concurrent[0].status === 'fulfilled' ? 'QUEUE-TEST-IOS-3' : 'QUEUE-TEST-IOS-2';
  const retry = await previewAssignment({ arNumber: remainingAr });
  await assignNext({ arNumber: remainingAr, queueToken: retry.queue.token }, 1);

  const imacPreview = await previewAssignment({ arNumber: 'QUEUE-TEST-IMAC-1' });
  const imac = await assignNext({ arNumber: 'QUEUE-TEST-IMAC-1', queueToken: imacPreview.queue.token }, 1);
  state = await availableQueues();
  assert(names(state, 'iMac')[0] === 'Bea', 'iMac queue did not advance independently');
  await changeEngineer(imac.endorsementId, 'Bea', 1);
  state = await availableQueues();
  assert(names(state, 'iMac').join(',') === 'Alex,Chen,Bea', 'Engineer correction did not transfer the iMac turn');
  await removeEndorsement(imac.endorsementId);
  state = await availableQueues();
  assert(names(state, 'iMac')[0] === 'Alex', 'deleting an assignment did not restore the iMac turn');

  const [countRows] = await pool.query("SELECT COUNT(*) AS total FROM engineer_endorsements WHERE ar_number LIKE 'QUEUE-TEST-%'");
  assert(Number((countRows as Array<{ total: number }>)[0].total) === 4, 'unexpected endorsement count after duplicate/concurrency checks');
  console.log('PASS: division isolation, manual counts, skips, stale review protection, concurrency, corrections, and deletion recovery');
  await pool.end();
}

run().catch(async (error) => { console.error(error); await getDbPool().end().catch(() => undefined); process.exitCode = 1; });
