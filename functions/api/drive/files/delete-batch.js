import { deleteFilesRoute, driveRoute } from '../../../services/drive/routes.js';

export const onRequestPost = driveRoute(deleteFilesRoute);
