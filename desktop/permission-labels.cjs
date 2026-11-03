const { createMainLocale } = require('./main-locales.cjs');

const permissionKeys = Object.freeze({
  ar: 'permissionAr', 'automatic-fullscreen': 'permissionAutomaticFullscreen', 'background-fetch': 'permissionBackgroundFetch', 'background-sync': 'permissionBackgroundSync',
  'captured-surface-control': 'permissionCapturedSurfaceControl', 'clipboard-read': 'permissionClipboardRead', 'clipboard-sanitized-write': 'permissionClipboardWrite', 'deprecated-sync-clipboard-read': 'permissionClipboardRead',
  'display-capture': 'permissionDisplayCapture', fileSystem: 'permissionFileSystem', fullscreen: 'permissionFullscreen', geolocation: 'permissionGeolocation', 'geolocation-approximate': 'permissionGeolocationApproximate',
  'hand-tracking': 'permissionHandTracking', hid: 'permissionHid', 'idle-detection': 'permissionIdleDetection', keyboardLock: 'permissionKeyboardLock', 'local-fonts': 'permissionLocalFonts',
  'local-network': 'permissionLocalNetwork', 'local-network-access': 'permissionLocalNetwork', 'loopback-network': 'permissionLoopbackNetwork', media: 'permissionMediaDevice', mediaKeySystem: 'permissionMediaKeySystem',
  midi: 'permissionMidi', midiSysex: 'permissionMidiSysex', nfc: 'permissionNfc', notifications: 'permissionNotifications', openExternal: 'permissionOpenExternal', 'payment-handler': 'permissionPaymentHandler',
  'periodic-background-sync': 'permissionPeriodicBackgroundSync', 'persistent-storage': 'permissionPersistentStorage', pointerLock: 'permissionPointerLock', 'screen-wake-lock': 'permissionScreenWakeLock', sensors: 'permissionSensors', serial: 'permissionSerial',
  'smart-card': 'permissionSmartCard', 'speaker-selection': 'permissionSpeakerSelection', 'storage-access': 'permissionStorageAccess', 'system-wake-lock': 'permissionSystemWakeLock', 'top-level-storage-access': 'permissionTopLevelStorageAccess',
  usb: 'permissionUsb', vr: 'permissionVr', 'web-app-installation': 'permissionWebAppInstallation', 'web-printing': 'permissionWebPrinting', 'window-management': 'permissionWindowManagement',
});
const unknownPermissionLabel = '一项尚未识别的浏览器权限';
function permissionDisplayName(permission, mediaTypes = [], locale = 'zh-CN') {
  const messages = typeof locale === 'string' ? createMainLocale(locale) : locale;
  if (permission === 'media' && Array.isArray(mediaTypes) && mediaTypes.length) {
    const labels = [...new Set(mediaTypes.map(type => type === 'audio' ? messages.t('permissionMicrophone') : type === 'video' ? messages.t('permissionCamera') : messages.t('permissionMediaDevice')))];
    return messages.formatList(labels);
  }
  const key = permissionKeys[permission];
  if (permission === 'display-capture' && Array.isArray(mediaTypes) && mediaTypes.includes('audio')) return messages.t('permissionDisplayCaptureWithAudio');
  return messages.t(key || 'unknownBrowserPermission');
}
module.exports = { permissionDisplayName, unknownPermissionLabel, permissionKeys };
