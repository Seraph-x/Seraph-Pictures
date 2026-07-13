import { createProfile, storageRoute } from '../services/storage-profiles/routes.js';

export const onRequestPost = storageRoute(createProfile);
