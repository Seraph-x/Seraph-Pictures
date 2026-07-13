import { driveRoute, listExplorer } from '../../services/drive/routes.js';

export const onRequestGet = driveRoute(listExplorer);
