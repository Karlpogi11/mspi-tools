CREATE TABLE IF NOT EXISTS `storage_employees` (
  `id` int AUTO_INCREMENT NOT NULL,
  `employee_number` varchar(50) NOT NULL,
  `full_name` varchar(255) NOT NULL,
  `active` int NOT NULL DEFAULT 1,
  `created_by` int,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  INDEX `storage_units_state_cabinet_idx` (`state`,`family`,`cabinet_number`),
  CONSTRAINT `storage_employees_id` PRIMARY KEY(`id`),
  CONSTRAINT `storage_employees_number_unique` UNIQUE(`employee_number`),
  CONSTRAINT `storage_employees_created_by_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `storage_units` (
  `id` int AUTO_INCREMENT NOT NULL,
  `ar_number` varchar(100) NOT NULL,
  `family` varchar(20) NOT NULL,
  `status` varchar(40) NOT NULL,
  `cabinet_number` int,
  `state` varchar(10) NOT NULL DEFAULT 'out',
  `current_employee_id` int,
  `checked_in_at` timestamp,
  `checked_out_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `storage_units_id` PRIMARY KEY(`id`),
  CONSTRAINT `storage_units_ar_unique` UNIQUE(`ar_number`),
  CONSTRAINT `storage_units_employee_fk` FOREIGN KEY (`current_employee_id`) REFERENCES `storage_employees`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `storage_movements` (
  `id` int AUTO_INCREMENT NOT NULL,
  `unit_id` int NOT NULL,
  `employee_id` int NOT NULL,
  `action` varchar(10) NOT NULL,
  `family` varchar(20) NOT NULL,
  `status` varchar(40) NOT NULL,
  `cabinet_number` int,
  `occurred_at` timestamp NOT NULL DEFAULT (now()),
  INDEX `storage_movements_unit_occurred_idx` (`unit_id`,`occurred_at`),
  CONSTRAINT `storage_movements_id` PRIMARY KEY(`id`),
  CONSTRAINT `storage_movements_unit_fk` FOREIGN KEY (`unit_id`) REFERENCES `storage_units`(`id`) ON DELETE CASCADE,
  CONSTRAINT `storage_movements_employee_fk` FOREIGN KEY (`employee_id`) REFERENCES `storage_employees`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
