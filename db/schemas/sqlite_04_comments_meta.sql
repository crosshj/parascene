-- Comment row extensions (reply snapshot, etc.). Run after sqlite_01.sql.

ALTER TABLE comments_created_image ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';
