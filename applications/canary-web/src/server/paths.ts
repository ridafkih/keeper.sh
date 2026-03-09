import path from "node:path";
import process from "node:process";

const appRoot = process.cwd();

export const clientDistDirectory = path.resolve(appRoot, "dist/client");
export const serverDistEntry = path.resolve(appRoot, "dist/server/server.js");
export const sourceTemplatePath = path.resolve(appRoot, "index.html");
