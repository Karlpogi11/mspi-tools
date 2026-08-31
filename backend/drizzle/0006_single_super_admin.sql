ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `is_super_admin` int NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `users` SET `is_super_admin` = 1 WHERE `id` = (SELECT `id` FROM (SELECT u.`id` FROM `users` u INNER JOIN `roles` r ON r.`id` = u.`role_id` WHERE r.`name` = 'Admin' ORDER BY u.`id` LIMIT 1) AS first_admin);
