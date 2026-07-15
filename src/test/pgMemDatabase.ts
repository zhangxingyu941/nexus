import { newDb } from "pg-mem";
import type { Pool, QueryResult, QueryResultRow } from "pg";

const COLUMN_SPECIFIC_SET_NULL = `,
    FOREIGN KEY (workspace_id, active_document_id)
      REFERENCES editor_documents(workspace_id, id)
      ON DELETE SET NULL (active_document_id)`;

interface PgMemTestDatabaseOptions {
  noAstCoverageCheck?: boolean;
}

interface TextQueryConfig {
  text: string;
  values?: unknown[];
}

type QueryInput = string | TextQueryConfig;
type PgMemQuery = (
  this: unknown,
  query: QueryInput,
  values?: unknown[],
) => Promise<QueryResult<QueryResultRow>>;

export function createPgMemTestDatabase(
  options: PgMemTestDatabaseOptions = {},
) {
  const database = newDb({
    autoCreateForeignKeyIndices: true,
    noAstCoverageCheck: options.noAstCoverageCheck,
  });
  const adapter = database.adapters.createPg();
  const prototype = adapter.Pool.prototype as unknown as { query: PgMemQuery };
  const query = prototype.query;
  const translatedStatements: string[] = [];

  prototype.query = async function (
    queryInput: QueryInput,
    values?: unknown[],
  ) {
    const text = typeof queryInput === "string" ? queryInput : queryInput.text;
    const parameters = typeof queryInput === "string" ? values : queryInput.values;
    let translatedText = text;

    if (text.includes(COLUMN_SPECIFIC_SET_NULL)) {
      translatedStatements.push(text);
      translatedText = text.replace(COLUMN_SPECIFIC_SET_NULL, "");
    }

    if (/^\s*DELETE\s+FROM\s+editor_documents\s+WHERE\s+/i.test(translatedText)) {
      const documentQuery = translatedText.replace(
        /^\s*DELETE\s+FROM\s+editor_documents/i,
        "SELECT workspace_id, id FROM editor_documents",
      );
      const documents = await query.call(this, documentQuery, parameters);

      for (const document of documents.rows) {
        await query.call(
          this,
          `UPDATE workspace_document_preferences
           SET active_document_id = NULL
           WHERE workspace_id = $1 AND active_document_id = $2`,
          [document.workspace_id, document.id],
        );
      }
    }

    const translatedInput = typeof queryInput === "string"
      ? translatedText
      : { ...queryInput, text: translatedText };
    return query.call(this, translatedInput, parameters);
  };

  return {
    pool: new adapter.Pool() as Pool,
    translatedStatements,
  };
}

export function createPgMemPool() {
  return createPgMemTestDatabase().pool;
}
