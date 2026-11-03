const { createMainLocale } = require('./main-locales.cjs');

function navigationFailureMessage(errorCode, detail = '', locale = 'zh-CN') {
  const source = `${errorCode} ${detail}`.toUpperCase();
  const messages = typeof locale === 'string' ? createMainLocale(locale) : locale;
  if (errorCode === -105 || source.includes('ERR_NAME_NOT_RESOLVED')) return messages.t('navigationServerNotFound');
  if (errorCode === -106 || source.includes('ERR_INTERNET_DISCONNECTED')) return messages.t('navigationNetworkDisconnected');
  if (errorCode === -102 || source.includes('ERR_CONNECTION_REFUSED')) return messages.t('navigationServerRefused');
  if (errorCode === -118 || source.includes('ERR_TIMED_OUT')) return messages.t('navigationTimedOut');
  if ((errorCode <= -200 && errorCode >= -299) || source.includes('ERR_CERT_')) return messages.t('navigationSecureConnectionFailed');
  return messages.t('navigationLoadFailed');
}

module.exports = { navigationFailureMessage };
