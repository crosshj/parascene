import http from "node:http";

const port = Number(process.env.PORT || 3000);

const server = http.createServer((request, response) => {
	response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
	response.end("Hello from Lightsail\n");
});

server.listen(port, "0.0.0.0", () => {
	console.log(`VPS hello-world server listening on port ${port}`);
});
