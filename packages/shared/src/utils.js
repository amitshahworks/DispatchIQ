/**
 * Pauses asynchronous execution for the provided duration.
 *
 * @param {number} milliseconds - Delay duration in milliseconds.
 * @returns {Promise<void>} Promise resolved after the delay.
 */
export function sleep(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new TypeError('milliseconds must be a non-negative finite number');
  }

  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Restricts a number to an inclusive range.
 *
 * @param {number} value - Number to restrict.
 * @param {number} minimum - Inclusive minimum.
 * @param {number} maximum - Inclusive maximum.
 * @returns {number} Restricted value.
 */
export function clamp(value, minimum, maximum) {
  if (![value, minimum, maximum].every(Number.isFinite)) {
    throw new TypeError('value, minimum and maximum must be finite numbers');
  }

  if (minimum > maximum) {
    throw new RangeError('minimum cannot be greater than maximum');
  }

  return Math.min(Math.max(value, minimum), maximum);
}
