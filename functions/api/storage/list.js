import { listProfiles, storageRoute } from '../../services/storage-profiles/routes.js';

export const onRequestGet = storageRoute(listProfiles);
