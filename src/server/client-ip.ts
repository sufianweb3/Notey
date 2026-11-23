/**
 * Each entry knows where its host puts the real client IP (Cloudflare:
 * cf-connecting-ip, Vercel: x-real-ip, Node: the socket). It passes that here,
 * and the app only ever reads CLIENT_IP_HEADER, so a client can't spoof the IP
 * that login rate limiting keys on.
 */
export const CLIENT_IP_HEADER = 'x-notey-client-ip';

export function withClientIp(req: Request, ip: string | null | undefined, url: string = req.url): Request {
  const headers = new Headers(req.headers);
  headers.delete(CLIENT_IP_HEADER);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  return new Request(url, {
    method: req.method,
    headers,
    body: req.body,
    redirect: req.redirect,
    signal: req.signal,
    // @ts-expect-error Node's fetch needs duplex for streamed bodies; ignored elsewhere
    duplex: 'half',
  });
}
