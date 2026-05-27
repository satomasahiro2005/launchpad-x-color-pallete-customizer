import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4174);

const contentTypes = {
  ".bin": "application/octet-stream",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const safePath = (urlPath) => {
  const cleaned = urlPath === "/" ? "/index.html" : urlPath;
  const absolute = normalize(join(rootDir, cleaned));
  if (!absolute.startsWith(rootDir)) throw new Error("Invalid path");
  return absolute;
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    const filePath = safePath(url.pathname);
    const data = await readFile(filePath);

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
    });
    response.end(data);
  } catch (error) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
  }
}).listen(port, () => {
  console.log(`LPX note site running at http://127.0.0.1:${port}`);
});
