/** Prevents destructive integration setup from targeting a normal database. */
export function requireTestDatabaseUrl(value = process.env.TEST_DATABASE_URL) {
  if (!value) throw new Error('TEST_DATABASE_URL es obligatoria para las pruebas de PostgreSQL.');
  const url = new URL(value);
  if (!/(?:^|[_-])test$/i.test(url.pathname.replace(/^\//, '')))
    throw new Error(
      'TEST_DATABASE_URL debe apuntar a una base aislada cuyo nombre termine en test.',
    );
  return value;
}
