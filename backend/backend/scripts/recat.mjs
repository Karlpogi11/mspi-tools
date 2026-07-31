import 'dotenv/config';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2 });

const [r1] = await pool.execute(`
  UPDATE pcount_products p
  LEFT JOIN pcount_product_extra pe
    ON pe.product_id = p.id AND pe.column_name IN ('Brand','brand')
  SET p.category = CASE
    WHEN pe.column_value IS NOT NULL AND LOWER(pe.column_value) LIKE '%apple%' THEN 'apple'
    WHEN pe.column_value IS NOT NULL AND TRIM(pe.column_value) <> '' THEN '3pp'
    WHEN UPPER(p.product_code) LIKE 'APP%' OR UPPER(p.product_code) LIKE 'APL%' THEN 'apple'
    WHEN UPPER(p.product_code) LIKE '3PP%' OR UPPER(p.product_code) LIKE 'THR%' THEN '3pp'
    ELSE ''
  END
`);
console.log('rows updated:', r1.affectedRows);

const [r2] = await pool.query(`SELECT category, COUNT(*) c FROM pcount_products GROUP BY category`);
console.log(r2);

await pool.end();
