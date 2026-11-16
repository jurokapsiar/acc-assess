// Generic --setup module used by tests: injects a request header on every request.
export const isolation = 'fresh-context';

export async function newContext({ browser, options }) {
  const context = await browser.newContext(options);
  await context.route('**/*', (route) => route.continue({ headers: { ...route.request().headers(), 'x-test-setup': '1' } }));
  return context;
}
