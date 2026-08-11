import {
  mysqlTable,
  int,
  varchar,
  timestamp,
  text,
  primaryKey,
  index,
  uniqueIndex,
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
  created_by: int('created_by').references(() => users.id, { onDelete: 'set null' }),
  join_code: varchar('join_code', { length: 4 }),
  submitted_at: timestamp('submitted_at'),
  submitted_by: int('submitted_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull().onUpdateNow(),
}, (table) => ({
  joinCodeUnique: uniqueIndex('pcount_sessions_join_code_unique').on(table.join_code),
}));

export const pcountSessionMembers = mysqlTable(
  'pcount_session_members',
  {
    session_id: int('session_id')
      .notNull()
      .references(() => pcountSessions.id, { onDelete: 'cascade' }),
    user_id: int('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joined_at: timestamp('joined_at').defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.session_id, table.user_id] }),
  })
);

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

export const reformatTemplates = mysqlTable('reformat_templates', {
  id: int('id').autoincrement().notNull().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  header_row: int('header_row').default(1).notNull(),
  columns: text('columns'),
  removed_columns: text('removed_columns'),
  created_by: int('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull().onUpdateNow(),
});

export const reformatTemplateShares = mysqlTable(
  'reformat_template_shares',
  {
    template_id: int('template_id')
      .notNull()
      .references(() => reformatTemplates.id, { onDelete: 'cascade' }),
    user_id: int('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    shared_at: timestamp('shared_at').defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.template_id, table.user_id] }),
  })
);

export const consumableMaster = mysqlTable(
  'consumable_master',
  {
    id: int('id').autoincrement().notNull().primaryKey(),
    part_number: varchar('part_number', { length: 100 }).notNull(),
    description: varchar('description', { length: 255 }).notNull(),
    category: varchar('category', { length: 100 }).default('Other').notNull(),
    expires: varchar('expires', { length: 1 }).default('Y').notNull(),
    unit: varchar('unit', { length: 20 }).default('pcs').notNull(),
    created_by: int('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at').defaultNow().notNull(),
    updated_at: timestamp('updated_at').defaultNow().notNull().onUpdateNow(),
  },
  (table) => ({
    partNumberUnique: uniqueIndex('consumable_master_part_number_unique').on(table.part_number),
  })
);

export const awbLog = mysqlTable(
  'awb_log',
  {
    id: int('id').autoincrement().notNull().primaryKey(),
    hawb: varchar('hawb', { length: 50 }).default(''),
    invoice_reference: varchar('invoice_reference', { length: 20 }).notNull(),
    invoice_total_amount: varchar('invoice_total_amount', { length: 20 }).default(''),
    delivery_date: varchar('delivery_date', { length: 40 }).default(''),
    total_qty: varchar('total_qty', { length: 20 }).default(''),
    received_date: varchar('received_date', { length: 40 }).default(''),
    original_filename: varchar('original_filename', { length: 255 }).default(''),
    month_folder: varchar('month_folder', { length: 60 }).default(''),
    status: varchar('status', { length: 20 }).default('ok').notNull(),
    created_by: int('created_by').references(() => users.id, { onDelete: 'set null' }),
    date_logged: timestamp('date_logged').defaultNow().notNull(),
  },
  (table) => ({
    invoiceRefUnique: uniqueIndex('awb_log_invoice_ref_unique').on(table.invoice_reference),
  })
);
