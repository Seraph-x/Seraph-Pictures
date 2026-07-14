import { commonMessages } from './messages/common';
import { driveMessages } from './messages/drive';
import { storageMessages } from './messages/storage';
import { uploadMessages } from './messages/upload';

const catalogs = [commonMessages, storageMessages, uploadMessages, driveMessages];

function mergeLocale(locale) {
  return Object.freeze(Object.assign({}, ...catalogs.map((catalog) => catalog[locale])));
}

export const messages = Object.freeze({
  zh: mergeLocale('zh'),
  en: mergeLocale('en'),
});
