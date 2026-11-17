export const productionCsp = [
  "default-src 'self'",
  "img-src 'self' blob:",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "font-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join("; ");
