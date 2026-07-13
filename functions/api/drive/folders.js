import {
  createFolderRoute, deleteFolderRoute, driveRoute,
} from '../../services/drive/routes.js';

export const onRequestPost = driveRoute(createFolderRoute);
export const onRequestDelete = driveRoute(deleteFolderRoute);
