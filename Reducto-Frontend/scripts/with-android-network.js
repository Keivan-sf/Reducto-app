const { withAndroidManifest } = require('expo/config-plugins');

// The sign-in screen accepts user-selected HTTP servers, including LAN servers.
// Android release builds otherwise reject cleartext traffic by default.
module.exports = function withAndroidNetwork(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) throw new Error('Android manifest has no application');
    application.$['android:usesCleartextTraffic'] = 'true';
    return config;
  });
};
