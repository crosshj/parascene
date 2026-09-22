import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const homepage = fs.readFileSync(path.join(__dirname, "index.html"));

const server = http.createServer((request, response) => {
	response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
	response.end(homepage);
});

server.listen(port, "0.0.0.0", () => {
	console.log(`VPS hello-world server listening on port ${port}`);
});
