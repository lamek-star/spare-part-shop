// PostgreSQL twin of ../migrations/0007_package_source_names.ts. Append-only: never
// edit a migration that has shipped; add a new version to BOTH lists.
export const p0007 = `
UPDATE catalogue_sources
   SET name = upper(substr(provider_key, 1, 1)) || substr(provider_key, 2)
 WHERE type = 'PACKAGE' AND url = '' AND name <> provider_key;
`;
