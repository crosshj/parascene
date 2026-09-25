import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const vpsDir = path.dirname(fileURLToPath(import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const nodemonCommand = path.join(vpsDir, "..", "node_modules", ".bin", process.platform === "win32" ? "nodemon.cmd" : "nodemon");
const children = [];

console.log(`[dev] starting beta at http://localhost:${process.env.PORT || 3000}/`);
console.log("[dev] Rollup and Express output will follow; refresh the browser after client changes.");

function start(command, args, label) {
	const child = spawn(command, args, {
		cwd: path.join(vpsDir, ".."),
		env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "development" },
		stdio: "inherit"
	});
	child.on("exit", (code, signal) => {
		if (signal) {
			console.error(`[dev] ${label} stopped (${signal})`);
		} else if (code !== 0) {
			console.error(`[dev] ${label} stopped with exit code ${code}`);
		}
	});
	children.push(child);
}

start(npmCommand, ["run", "build", "--", "--watch"], "Rollup watch");
start(nodemonCommand, ["--watch", "server.js", "--watch", "routes", "--watch", "db", "server.js"], "Express server");

function stop() {
	for (const child of children) {
		if (!child.killed) child.kill("SIGTERM");
	}
}

process.once("SIGINT", () => {
	stop();
	process.exit(0);
});
process.once("SIGTERM", () => {
	stop();
	process.exit(0);
});
