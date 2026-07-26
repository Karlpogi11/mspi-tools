import {
  mysqlTable,
  int,
  varchar,
  timestamp,
  text,
  primaryKey,
  index,
} from 'drizzle-orm/mysql-core';

export const roles = mysqlTable('roles', {
  id: int('id').autoincrement().notNull().primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(),
});

export const users = mysqlTable('users', {
  id: int('id').autoincrement().notNull().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password_hash: varchar('password_hash', { length: 255 }).notNull(),
  full_name: varchar('full_name', { length: 255 }).notNull(),
  role_id: int('role_id').references(() => roles.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
});

export const tools = mysqlTable('tools', {
  id: int('id').autoincrement().notNull().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  url: varchar('url', { length: 500 }).notNull(),
  icon: varchar('icon', { length: 50 }).notNull(),
  description: varchar('description', { length: 500 }).notNull(),
});

export const roleToolAccess = mysqlTable(
  'role_tool_access',
  {
    role_id: int('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    tool_id: int('tool_id')
      .notNull()
      .references(() => tools.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.role_id, table.tool_id] }),
  })
);

export const pcountSessions = mysqlTable('pcount_sessions', {
  id: int('id').autoincrement().notNull().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  sort_desc: int('sort_desc').default(1).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull().onUpdateNow(),
});

export const pcountDisplayColumns = mysqlTable('pcount_display_columns', {
  id: int('id').autoincrement().notNull().primaryKey(),
  session_id: int('session_id').notNull().references(() => pcountSessions.id, { onDelete: 'cascade' }),
  column_name: varchar('column_name', { length: 255 }).notNull(),
});

export const pcountProducts = mysqlTable('pcount_products', {
  id: int('id').autoincrement().notNull().primaryKey(),
  session_id: int('session_id').notNull().references(() => pcountSessions.id, { onDelete: 'cascade' }),
  product_code: varchar('product_code', { length: 255 }).notNull(),
  description: varchar('description', { length: 500 }).default(''),
  category: varchar('category', { length: 20 }).default(''),
  system_qty: int('system_qty').default(0),
  counted_qty: int('counted_qty').default(0),
  adjusted_qty: int('adjusted_qty'),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  notes: text('notes'),
}, (table) => ({
  sessionProductCodeIdx: index('pcount_products_session_code_idx').on(table.session_id, table.product_code),
}));

export const pcountProductExtra = mysqlTable('pcount_product_extra', {
  id: int('id').autoincrement().notNull().primaryKey(),
  product_id: int('product_id').notNull().references(() => pcountProducts.id, { onDelete: 'cascade' }),
  column_name: varchar('column_name', { length: 255 }).notNull(),
  column_value: text('column_value'),
});
