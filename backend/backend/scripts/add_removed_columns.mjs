import 'dotenv/config';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2 });

await pool.query(`ALTER TABLE reformat_templates ADD COLUMN removed_columns TEXT NULL AFTER columns`);
console.log('added removed_columns');

const [cols] = await pool.query(`SHOW COLUMNS FROM reformat_templates`);
console.log(cols.map((c) => c.Field).join(', '));

await pool.end();
