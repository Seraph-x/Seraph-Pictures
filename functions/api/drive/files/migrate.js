import { driveRoute, migrateFilesRoute } from '../../../services/drive/routes.js';

export const onRequestPost = driveRoute(migrateFilesRoute);
