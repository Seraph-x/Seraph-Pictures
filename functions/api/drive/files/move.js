import { driveRoute, moveFilesRoute } from '../../../services/drive/routes.js';

export const onRequestPost = driveRoute(moveFilesRoute);
