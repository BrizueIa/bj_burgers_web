const { withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withAndroidSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    if (
      mod.modResults.language !== 'groovy' ||
      mod.modResults.contents.includes('BJ signing configuration v2')
    )
      return mod;
    let contents = mod.modResults.contents;
    contents = contents.replace(
      'android {',
      `def signingProperties = new Properties()
def signingPropertiesFile = rootProject.file("signing.properties")
if (signingPropertiesFile.exists()) signingProperties.load(new FileInputStream(signingPropertiesFile))

android {\n    // BJ signing configuration v2: properties are generated outside version control.\n    if (signingPropertiesFile.exists()) {\n        signingConfigs {\n            release {\n                storeFile file(signingProperties['storeFile'])\n                storePassword signingProperties['storePassword']\n                keyAlias signingProperties['keyAlias']\n                keyPassword signingProperties['keyPassword']\n            }\n        }\n    }`,
    );
    contents = contents.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      '$1if (signingPropertiesFile.exists()) signingConfig signingConfigs.release\n            else signingConfig signingConfigs.debug',
    );
    mod.modResults.contents = contents;
    return mod;
  });
};
