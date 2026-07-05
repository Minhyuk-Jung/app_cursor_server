/** 02 §11, 03 §10: 인메모리 슬iding-window rate limiter */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

export class RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  check(key: string): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }

    if (bucket.count >= this.max) {
      return { allowed: false, retryAfterMs: Math.max(0, bucket.resetAt - now) };
    }

    bucket.count += 1;
    return { allowed: true };
  }

  /** 테스트용 */
  clear(): void {
    this.buckets.clear();
  }
}
