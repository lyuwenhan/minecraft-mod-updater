import fs from "node:fs";
const out = process.env.GITHUB_OUTPUT;
if (!out) {
	console.error("GITHUB_OUTPUT is not set");
	process.exit(1)
}
const path = "status.json";
if (!fs.existsSync(path)) {
	fs.appendFileSync(out, "should_release=false\n");
	console.log("status.json is missing — skipping release and resetting status.json.");
	process.exit(0)
}
try {
	const status = JSON.parse(fs.readFileSync(path, "utf8"));
	const shouldRelease = status.needsUpdate === true;
	fs.appendFileSync(out, `should_release=${shouldRelease}\n`);
	console.log(shouldRelease ? "needsUpdate is true — running build and release." : "needsUpdate is false — skipping release and resetting status.json.")
} catch (error) {
	fs.appendFileSync(out, "should_release=false\n");
	console.log(`Invalid status.json — skipping release and resetting status.json: ${error.message}`);
	process.exit(0)
}
