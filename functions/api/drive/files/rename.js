import { driveRoute, renameFileRoute } from '../../../services/drive/routes.js';

export const onRequestPost = driveRoute(renameFileRoute);
