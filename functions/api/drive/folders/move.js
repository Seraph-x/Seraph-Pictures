import { driveRoute, moveFolderRoute } from '../../../services/drive/routes.js';

export const onRequestPost = driveRoute(moveFolderRoute);
