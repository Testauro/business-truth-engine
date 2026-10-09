/** Hide credentials in a connection string for logs and reports. */
export function redactConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password !== '') url.password = '***';
    return url.toString();
  } catch {
    return '<connection string>';
  }
}
