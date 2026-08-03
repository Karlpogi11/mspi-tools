CREATE TABLE `consumable_master` (
	`id` int AUTO_INCREMENT NOT NULL,
	`part_number` varchar(100) NOT NULL,
	`description` varchar(255) NOT NULL,
	`category` varchar(100) NOT NULL DEFAULT 'Other',
	`expires` varchar(1) NOT NULL DEFAULT 'Y',
	`unit` varchar(20) NOT NULL DEFAULT 'pcs',
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `consumable_master_id` PRIMARY KEY(`id`),
	CONSTRAINT `consumable_master_part_number_unique` UNIQUE(`part_number`)
);
--> statement-breakpoint
ALTER TABLE `consumable_master` ADD CONSTRAINT `consumable_master_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;