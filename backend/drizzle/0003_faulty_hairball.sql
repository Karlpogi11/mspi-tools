CREATE TABLE `awb_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`hawb` varchar(50) DEFAULT '',
	`invoice_reference` varchar(20) NOT NULL,
	`invoice_total_amount` varchar(20) DEFAULT '',
	`delivery_date` varchar(40) DEFAULT '',
	`total_qty` varchar(20) DEFAULT '',
	`received_date` varchar(40) DEFAULT '',
	`original_filename` varchar(255) DEFAULT '',
	`month_folder` varchar(60) DEFAULT '',
	`status` varchar(20) NOT NULL DEFAULT 'ok',
	`created_by` int,
	`date_logged` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `awb_log_id` PRIMARY KEY(`id`),
	CONSTRAINT `awb_log_invoice_ref_unique` UNIQUE(`invoice_reference`)
);
--> statement-breakpoint
ALTER TABLE `awb_log` ADD CONSTRAINT `awb_log_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;