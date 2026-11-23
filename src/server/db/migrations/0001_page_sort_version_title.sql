ALTER TABLE `page` ADD `sort` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `page_version` ADD `title` text DEFAULT '' NOT NULL;