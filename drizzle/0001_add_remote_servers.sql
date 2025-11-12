CREATE TABLE `remote_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`grpc_url` text NOT NULL,
	`ws_url` text NOT NULL,
	`token` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used` text
);
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `mode` text DEFAULT 'local' NOT NULL;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `remote_server_id` text REFERENCES `remote_servers`(`id`) ON UPDATE no action ON DELETE set null;
