const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * The server uses NodeNext-style `.js` specifiers in TypeScript source. Metro
 * consumes that source directly from workspace packages, so resolve only their
 * relative specifiers without the emitted extension. Node's production build
 * continues to use the original `.js` specifiers unchanged.
 */
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    return context.resolveRequest(context, moduleName.slice(0, -3), platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
