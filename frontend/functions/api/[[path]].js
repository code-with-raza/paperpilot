const BACKEND = 'https://refactored-spoon-qvx657x6qv4rc9x4g-8000.app.github.dev'

// Keep auth cookies on the Pages origin and stream uploads/PDFs unchanged.
export async function onRequest({ request }) {
  const incoming = new URL(request.url)
  const target = new URL(BACKEND)
  target.pathname = incoming.pathname.replace(/^\/api(?=\/|$)/, '') || '/'
  target.search = incoming.search
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.set('x-forwarded-host', incoming.host)
  headers.set('x-forwarded-proto', 'https')
  try {
    const upstream = await fetch(new Request(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    }))
    const response = new Response(upstream.body, upstream)
    response.headers.set('Cache-Control', 'no-store')
    const location = response.headers.get('Location')
    if (location) {
      const redirect = new URL(location, target)
      if (redirect.origin === target.origin) {
        response.headers.set('Location', `${incoming.origin}/api${redirect.pathname}${redirect.search}${redirect.hash}`)
      }
    }
    return response
  } catch {
    return Response.json({ detail: 'The backend is temporarily unreachable. Please try again.' }, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
