-- Full-text search over page titles and Markdown bodies (tasks join in M2).
-- Maintained by services/search.ts on every save, trash and restore.
CREATE VIRTUAL TABLE IF NOT EXISTS `search_fts` USING fts5(
  `workspace_id` UNINDEXED,
  `kind` UNINDEXED,
  `item_id` UNINDEXED,
  `title`,
  `body`,
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `folder_parent_idx` ON `folder` (`workspace_id`, `parent_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `page_folder_idx` ON `page` (`workspace_id`, `folder_id`);
