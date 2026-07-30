/**
 * @file not-found.js
 * @description Catch-all middleware for unmatched routes. Must be registered
 * after all real routes and before the centralized error handler.
 */

/**
 * Responds with a consistent JSON 404 for any route that didn't match an
 * earlier handler.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function notFound(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} was not found.`,
    },
  });
}
