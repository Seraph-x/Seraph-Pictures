import {
  deleteProfile, storageRoute, updateProfile,
} from '../../services/storage-profiles/routes.js';

export const onRequestPut = storageRoute(updateProfile);
export const onRequestDelete = storageRoute(deleteProfile);
