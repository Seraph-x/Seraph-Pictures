import { setDefaultProfile, storageRoute } from '../../../services/storage-profiles/routes.js';

export const onRequestPost = storageRoute(setDefaultProfile);
