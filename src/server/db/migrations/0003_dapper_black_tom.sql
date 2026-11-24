ALTER TABLE `api_token` ADD `rate_window` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `api_token` ADD `rate_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `api_token` ADD `client_id` text;--> statement-breakpoint
ALTER TABLE `oauth_grant` ADD `redirect_uri` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `oauth_grant` ADD `code_challenge` text DEFAULT '' NOT NULL;