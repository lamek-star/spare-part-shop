/** H4: catalogue sources created automatically by package imports were named after the FIRST package's
 * own description ("Nengun Toyota Prado ... starter batch"), which every later package of the same
 * provider then showed. Such a source is shared by the whole provider, so it is renamed after the
 * provider ("Nengun"). Only automatic package sources (type PACKAGE, no URL) are touched; a source a
 * package declared explicitly with its own address keeps its name. */
export const m0007 = `
UPDATE catalogue_sources
   SET name = upper(substr(provider_key, 1, 1)) || substr(provider_key, 2)
 WHERE type = 'PACKAGE' AND url = '' AND name <> provider_key;
`;
