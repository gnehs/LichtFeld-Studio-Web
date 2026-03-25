export function getSessionTrustProxy(nodeEnv: string): number | false {
  return nodeEnv === "production" ? 1 : false;
}

export function getSessionCookieSecure(nodeEnv: string): boolean | "auto" {
  return nodeEnv === "production" ? "auto" : false;
}
