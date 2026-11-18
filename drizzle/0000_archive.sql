CREATE TABLE essay_revisions (
  essay_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  saved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (essay_id, revision)
);
--> statement-breakpoint
CREATE VIEW current_essays AS
SELECT e.* FROM essay_revisions e
WHERE e.revision = (SELECT MAX(n.revision) FROM essay_revisions n WHERE n.essay_id = e.essay_id);
--> statement-breakpoint
CREATE TABLE user_sentence_progress (
  user_id TEXT NOT NULL,
  essay_id TEXT NOT NULL,
  sentence_id TEXT NOT NULL,
  favorite INTEGER CHECK (favorite IN (0, 1)),
  mastered INTEGER CHECK (mastered IN (0, 1)),
  PRIMARY KEY (user_id, essay_id, sentence_id)
);
--> statement-breakpoint
CREATE VIEW essay_sentences AS
SELECT e.essay_id, json_extract(s.value, '$.id') AS sentence_id, s.value AS payload
FROM current_essays e JOIN json_each(e.payload, '$.record.sentences') s WHERE e.archived = 0;
