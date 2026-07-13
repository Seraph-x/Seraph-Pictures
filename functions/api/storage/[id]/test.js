import { storageRoute, testProfileById } from '../../../services/storage-profiles/routes.js';

export const onRequestPost = storageRoute(testProfileById);
