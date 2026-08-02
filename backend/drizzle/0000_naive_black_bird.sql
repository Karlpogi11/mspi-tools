CREATE TABLE `pcount_display_columns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`session_id` int NOT NULL,
	`column_name` varchar(255) NOT NULL,
	CONSTRAINT `pcount_display_columns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pcount_product_extra` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`column_name` varchar(255) NOT NULL,
	`column_value` text,
	CONSTRAINT `pcount_product_extra_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pcount_products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`session_id` int NOT NULL,
	`product_code` varchar(255) NOT NULL,
	`description` varchar(500) DEFAULT '',
	`category` varchar(20) DEFAULT '',
	`system_qty` int DEFAULT 0,
	`counted_qty` int DEFAULT 0,
	`adjusted_qty` int,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`notes` text,
	CONSTRAINT `pcount_products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pcount_session_members` (
	`session_id` int NOT NULL,
	`user_id` int NOT NULL,
	`joined_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pcount_session_members_session_id_user_id_pk` PRIMARY KEY(`session_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `pcount_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`sort_desc` int NOT NULL DEFAULT 1,
	`created_by` int,
	`join_code` varchar(4),
	`submitted_at` timestamp,
	`submitted_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pcount_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `pcount_sessions_join_code_unique` UNIQUE(`join_code`)
);
--> statement-breakpoint
CREATE TABLE `reformat_template_shares` (
	`template_id` int NOT NULL,
	`user_id` int NOT NULL,
	`shared_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reformat_template_shares_template_id_user_id_pk` PRIMARY KEY(`template_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `reformat_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`header_row` int NOT NULL DEFAULT 1,
	`columns` text,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reformat_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `role_tool_access` (
	`role_id` int NOT NULL,
	`tool_id` int NOT NULL,
	CONSTRAINT `role_tool_access_role_id_tool_id_pk` PRIMARY KEY(`role_id`,`tool_id`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(50) NOT NULL,
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `roles_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `tools` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`url` varchar(500) NOT NULL,
	`icon` varchar(50) NOT NULL,
	`description` varchar(500) NOT NULL,
	CONSTRAINT `tools_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`role_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `pcount_display_columns` ADD CONSTRAINT `pcount_display_columns_session_id_pcount_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `pcount_sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pcount_product_extra` ADD CONSTRAINT `pcount_product_extra_product_id_pcount_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `pcount_products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pcount_products` ADD CONSTRAINT `pcount_products_session_id_pcount_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `pcount_sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pcount_session_members` ADD CONSTRAINT `pcount_session_members_session_id_pcount_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `pcount_sessions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pcount_session_members` ADD CONSTRAINT `pcount_session_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pcount_sessions` ADD CONSTRAINT `pcount_sessions_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pcount_sessions` ADD CONSTRAINT `pcount_sessions_submitted_by_users_id_fk` FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reformat_template_shares` ADD CONSTRAINT `reformat_template_shares_template_id_reformat_templates_id_fk` FOREIGN KEY (`template_id`) REFERENCES `reformat_templates`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reformat_template_shares` ADD CONSTRAINT `reformat_template_shares_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reformat_templates` ADD CONSTRAINT `reformat_templates_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_tool_access` ADD CONSTRAINT `role_tool_access_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_tool_access` ADD CONSTRAINT `role_tool_access_tool_id_tools_id_fk` FOREIGN KEY (`tool_id`) REFERENCES `tools`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `pcount_products_session_code_idx` ON `pcount_products` (`session_id`,`product_code`);