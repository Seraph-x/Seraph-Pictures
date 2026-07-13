import { driveRoute, listTree } from '../../services/drive/routes.js';

export const onRequestGet = driveRoute(listTree);
