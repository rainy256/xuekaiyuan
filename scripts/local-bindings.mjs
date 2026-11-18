import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function localBindings(name = ':memory:') {
  const db = new DatabaseSync(name);
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'essay_revisions'").get()) {
    db.exec(readFileSync(new URL('../drizzle/0000_archive.sql', import.meta.url), 'utf8'));
  }
  const objects = new Map();
  return {
    close: () => db.close(),
    OWNER_EMAIL: 'local@example.test',
    MIGRATION_KEY: 'local-dev-only',
    DB: {
      prepare(query) {
        return {
          bind(...values) {
            return {
              first: async () => db.prepare(query).get(...values) ?? null,
              all: async () => ({ results: db.prepare(query).all(...values) }),
              run: async () => ({ meta: { changes: db.prepare(query).run(...values).changes } }),
            };
          },
        };
      },
      async batch(statements) {
        db.exec('BEGIN');
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          db.exec('COMMIT');
          return results;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
    BUCKET: {
      head: async key => objects.has(key) ? {} : null,
      put: async (key, bytes, options) => {
        objects.set(key, { bytes: Uint8Array.from(bytes), httpMetadata: options.httpMetadata });
      },
      get: async key => {
        const object = objects.get(key);
        return object ? {
          body: object.bytes,
          httpMetadata: object.httpMetadata,
          arrayBuffer: async () => object.bytes.slice().buffer,
        } : null;
      },
    },
  };
}
