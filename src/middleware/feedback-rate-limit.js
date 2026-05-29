/**
 * Feedback Rate Limiting Middleware
 * Limits feedback submissions to 1 per 5 minutes per user
 */

/**
 * Rate limit feedback submissions
 * Uses Redis to track submission timestamps
 * Limit: 1 submission per 5 minutes per authenticated user
 */
export async function feedbackRateLimit(req, res, next) {
  const accountId = req.session?.accountInfo?.account_id;

  console.log('[Feedback Rate Limit] Checking rate limit for account:', accountId);

  if (!accountId) {
    console.log('[Feedback Rate Limit] No account ID, returning 401');
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  const redisKey = `feedback:rate_limit:${accountId}`;
  const rateLimitWindow = 5 * 60; // 5 minutes in seconds

  console.log('[Feedback Rate Limit] Checking Redis key:', redisKey);

  try {
    // Check if user has submitted recently (use native promise API)
    const lastSubmission = await req.app.locals.redisClient.get(redisKey);

    console.log('[Feedback Rate Limit] Got last submission:', lastSubmission);

    if (lastSubmission) {
      const timeRemaining = rateLimitWindow - (Date.now() - parseInt(lastSubmission, 10)) / 1000;
      if (timeRemaining > 0) {
        console.log('[Feedback Rate Limit] Rate limit exceeded, time remaining:', timeRemaining);
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil(timeRemaining)
        });
      }
    }

    // Set rate limit key with TTL
    console.log('[Feedback Rate Limit] Setting Redis key with TTL:', rateLimitWindow);
    await req.app.locals.redisClient.setEx(redisKey, rateLimitWindow, Date.now().toString());

    console.log('[Feedback Rate Limit] Rate limit check passed, calling next()');
    next();

  } catch (err) {
    console.error('[Feedback Rate Limit] Redis error:', err);
    // Allow request if Redis fails (fail open)
    next();
  }
}
