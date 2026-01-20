/**
 * Silence matrix-js-sdk logging
 * This patches the SDK's logger after it's loaded
 */

import { logger } from "matrix-js-sdk/lib/logger.js";

const DEBUG = process.env.MATRIX_DEBUG === "1";

if (!DEBUG) {
  const noop = () => {};

  // Create a silent methodFactory
  const silentMethodFactory = function (methodName, logLevel, loggerName) {
    return noop;
  };

  // Patch the SDK logger's methodFactory to return no-ops
  logger.methodFactory = silentMethodFactory;

  // Set to silent level
  logger.setLevel("silent");

  // Also patch getChild to return loggers that use the same silent methodFactory
  const originalGetChild = logger.getChild.bind(logger);
  logger.getChild = function (prefix) {
    const child = originalGetChild(prefix);
    // Ensure child uses silent methodFactory and silent level
    child.methodFactory = silentMethodFactory;
    child.setLevel("silent");
    return child;
  };
}

export default DEBUG;
