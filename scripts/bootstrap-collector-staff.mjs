import { openCollectorDatabase } from '../collector-server/database.js';
import { bootstrapCollectorStaff } from '../collector-server/auth.js';

const username = process.argv[2] || process.env.COLLECTOR_ADMIN_USERNAME || 'collector-admin';
const password = process.argv[3] || process.env.COLLECTOR_ADMIN_PASSWORD;
const role = process.argv[4] || 'collector_admin';
if (!password) {
  console.error('Usage: node scripts/bootstrap-collector-staff.mjs <username> <password> [collector_admin|collector_reviewer]');
  process.exit(1);
}
const db = await openCollectorDatabase();
try {
  console.log(await bootstrapCollectorStaff(db, { username, password, role }));
} finally {
  await db.close();
}
